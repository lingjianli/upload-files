const SIZE = 1 * 1024 * 1024;  // 切片大小

const Status = {
  wait: 'wait',
  pause: 'pause',
  uploading: 'uploading'
};

const container = {
  file: null,
  hash: '',
  worker: {
    onmessage: null
  }
};

// 请求队列
let requestList = [];
// 上传状态
let status = Status.wait;
let data = [];

$('#upload').addEventListener('change', function (e) {
  // 获取上传的文件
  const [file] = e.target.files;
  console.log(file)

  if (!file) return;

  // 重置请求队列
  resetData();

  container.file = file
})

$('#submit').addEventListener('click', async (e) => {
  if (!container.file) return;
  status = Status.uploading;
  const fileChunkList = createFileChunk(container.file);
  // container.hash = await calculateHash(fileChunkList);
  container.hash = await calculateHashByWorker(fileChunkList);

  console.log(container.hash, 222)
  const { shouldUpload, uploadedList, imgUrl } = await verifyUpload(
    container.file.name,
    container.hash
  );
  console.log('shouldUpload', shouldUpload);
  if (!shouldUpload) {
    $('#progress').value = 100;
    // calculateProgress();
    status = Status.wait;
    return;
  }

  data = fileChunkList.map(({ file }, index) => ({
    fileHash: container.hash,
    index,
    hash: container.hash + '-' + index,
    chunk: file,
    size: file.size,
    percentage: uploadedList.includes(index) ? 100 : 0
  }));

  const result = await uploadChunks(uploadedList);

  console.log(result)
  return false;
})



function resetData() {
  requestList.forEach(xhr => xhr.abort());
  requestList = [];
  $('#progress').value = 0;
}

// 生成文件切片
function createFileChunk(file, size = SIZE) {
  const fileChunkList = [];
  let cur = 0;
  while (cur < file.size) {
    fileChunkList.push({ file: file.slice(cur, cur + size )});
    cur += size;
  }
  return fileChunkList;
}

function calculateHashByWorker(fileChunkList) {
  return new Promise(resolve => {
    const start = new Date();
    container.worker = new Worker("./lib/hash.js");
    container.worker.postMessage({ fileChunkList });
    container.worker.onmessage = e => {
      const { percentage, hash } = e.data;
      if (hash) {
        const end = new Date();
        console.log((end - start) / 1000);
        resolve(hash);
      }
    };
  });
}


// 生成文件 hash
function calculateHash(fileChunkList) {
  return new Promise(resolve => {
    let count = 0;
    const spark = new SparkMD5.ArrayBuffer();
    const start = new Date();
    const loadNext = index => {
      const reader = new FileReader();
      reader.readAsArrayBuffer(fileChunkList[index].file);

      reader.onload = e => {
        count++;

        console.log('计算hash时间')
        spark.append(e.target.result);

        if (count === fileChunkList.length) {
          const end = new Date();

          console.log((end - start) / 1000);
          resolve(spark.end());
        } else {
          loadNext(count);
        }
      }
    };
    loadNext(0);
  })
}

// 根据 hash 验证文件是否曾经已被上传过
// 没有才进行上传
async function verifyUpload(filename, fileHash) {
  const result = await request({
    url: 'http://localhost:8888/verify',
    headers: {
      'Content-Type': 'application/json'
    },
    data: JSON.stringify({
      filename,
      fileHash
    })
  });

  console.log(result);
  return JSON.parse(result.data)
}

// 上传切片，同时过滤已上传的切片
async function uploadChunks(uploadedList = []) {
  const tempRequestList = data
    .filter(({ hash }) => !uploadedList.includes(hash))
    .map(({ chunk, hash, index }) => {
      const formData = new FormData();
      formData.append('chunk', chunk);
      formData.append('hash', hash);
      formData.append('filename', container.file.name);
      formData.append('fileHash', container.hash);

      return { formData, index };
    })
    .map(({ formData, index }) => ({
      url: 'http://localhost:8888/upload',
      data: formData,
      onProgress: createProgressHandler(data[index]),
      requestList: requestList
    }));
    // await Promise.all(tempRequestList);

    // 合并切片
    // if (uploadedList.length + tempRequestList.length === data.length) {
    //   console.log('上传完成');
    //   await mergeRequest();
    // }

    // 并发请求
    maxRequestLimit(tempRequestList, 10, async (res) => {
      console.log('完成啦', res)
      await mergeRequest();
    })
}

/**
 * 
 * @param {Array} configList // 请求配置数组，比如[{ url: 'xxx1', method: 'post', ... }, { url: 'xxx2', method: 'post', ... }]
 * @param {number} max  // 支持并发请求的数量
 * @param {Function} callback // 上传完全部切片后的回调函数
 */
function maxRequestLimit(configList, max = 10, callback) {
  if (!configList || !max) return;

  if (configList.length === 0) return callback(null);

  let i = 0,
    cacheRequest = [],  // 缓存请求
    result = [];  // 缓存请求结果
  
  // 真正请求的地方
  function toRequest() {
    // 结束递归的条件
    if (i === configList.length) return Promise.resolve();

    // 真正处理请求,缓存请求
    const tempRequest = request(configList[i++]);
    cacheRequest.push(tempRequest);

    tempRequest.then(res => {
      result.push(res);
      cacheRequest.splice(cacheRequest.indexOf(tempRequest), 1);
    });

    let p = Promise.resolve();
    // 当缓存数量达到最大值
    if (cacheRequest.length >= max) {
      p = Promise.race(cacheRequest);
    }

    return p.then(() => toRequest());
  }

  toRequest()
    .then(() => Promise.all(cacheRequest))
    .then(() => callback(result))
}

// 通知服务端合并请求
async function mergeRequest() {
  await request({
    url: 'http://localhost:8888/merge',
    headers: {
      'Content-Type': 'application/json'
    },
    data: JSON.stringify({
      size: SIZE,
      fileHash: container.hash,
      filename: container.file.name
    })
  });

  alert('上传成功');
  status = Status.wait;
}

function createProgressHandler(item) {
  return e => {
    item.percentage = parseInt(String((e.loaded / e.total) * 100));

    calculateProgress();
  }
}

function calculateProgress() {
  const loaded = data
    .map(item => item.size * item.percentage)
    .reduce((acc, cur) => acc + cur);
  
  const uploadPercentage = parseInt(loaded / container.file.size);
  // console.log(uploadPercentage);
  $('#progress').value = uploadPercentage;
}
