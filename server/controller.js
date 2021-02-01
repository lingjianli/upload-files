const multiparty = require("multiparty");
const path = require("path");
const fs = require("fs-extra");

// 提取后缀名
const extractExt = filename => filename.slice(filename.lastIndexOf("."), filename.length);
// 大文件存储目录
const UPLOAD_DIR = path.resolve(__dirname, "..", "target");

const pipeStream = (path, writeStream) => new Promise(resolve => {
  const readStream = fs.createReadStream(path);

  console.log(path);
  readStream.on("end", () => {
    fs.unlinkSync(path);
    resolve();
  })

  readStream.pipe(writeStream);
})

// 合并切片
const mergeFileChunk = async (filePath, fileHash, size) => {
  // 切片目录
  const chunkDir = path.resolve(UPLOAD_DIR, fileHash);
  const chunkPaths = await fs.readdir(chunkDir);
  // 根据切片下标进行排序
  // 否则直接读取目录的获得的顺序可能会错乱
  chunkPaths.sort((a, b) => a.split("-")[1] - b.split("-")[1]);
  await Promise.all(chunkPaths.map(async (chunkPath, index) => {
    console.log(11, path.resolve(chunkDir, chunkPath))
    await pipeStream(
      path.resolve(chunkDir, chunkPath),
      // 指定位置创建可写流
      fs.createWriteStream(filePath, {
        start: index * size,
        end: (index + 1) * size
      })
    )
    
  }));

  // 合并后删除保存切片的目录
  fs.rmdirSync(chunkDir); 
}



const resolvePost = req => new Promise(resolve => {
  let chunk = "";
  req.on("data", data => {
    // console.log(data);
    chunk += data;
  })
  req.on("end", () => {
    // console.log(JSON.parse(chunk))
    resolve(JSON.parse(chunk));
  })
})

// 返回已经上传切片名
const createUploadList = async fileHash => 
  fs.existsSync(path.resolve(UPLOAD_DIR, fileHash)) 
    ? await fs.readdir(path.resolve(UPLOAD_DIR, fileHash)) 
    : [];


module.exports = class Controller {
  // 合并切片
  async handleMerge(req, res) {
    const data = await resolvePost(req);
    const { fileHash, filename, size } = data;
    // 后缀名
    const ext = extractExt(filename);
    // 文件路径
    const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${ext}`);
    // console.log('ext', ext, 'filePath', filePath)
    await mergeFileChunk(filePath, fileHash, size);
    // console.log(req, res);
    res.end(
      JSON.stringify({
        code: 200,
        message: "file merged success"
      })
    )
  }

  // 处理切片
  async handleFormData(req, res) {
    const form = new multiparty.Form();
    
    form.parse(req, async (err, fields, files) => {
      if (err) {
        // console.error(err);
        res.status = 500;
        res.end("process file chunk failed");
        return;
      }

      const [chunk] = files.chunk;
      const { hash: [hash], filename: [filename], fileHash: [fileHash] } = fields;

      // 文件路径
      const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${extractExt(filename)}`);
      // 切片目录
      const chunkDir = path.resolve(UPLOAD_DIR, fileHash);
      
      // 文件存在直接返回
      if (fs.existsSync(filePath)) {
        res.end("file exist");
        return;
      }

      // 切片目录不存在，创建切片目录
      if (!fs.existsSync(chunkDir)) {
        await fs.mkdirs(chunkDir);
      }
      
      await fs.move(chunk.path, path.resolve(chunkDir, hash));
      res.end("received file chunk");
      // console.log("切片目录", filePath, chunkDir)
    })
  }

  // 验证是否已上传/已上传切片下标
  async handleVerifyUpload(req, res) {
    const data = await resolvePost(req);
    const { fileHash, filename, size } = data;
    const ext = extractExt(filename);
    // 文件目录
    const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${ext}`);

    // console.log('verify', filePath)

    if (fs.existsSync(filePath)) {
      res.end(
        JSON.stringify({
          shouldUpload: false,
          imgUrl: filePath
        })
      );
    } else {
      res.end(
        JSON.stringify({
          shouldUpload: true,
          uploadedList: await createUploadList(fileHash)
        })
      )
    }
  }
}