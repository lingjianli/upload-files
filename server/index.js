const http = require("http");
const server = http.createServer();
const Controller = require('./controller');

const controller = new Controller();

server.on("request", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    res.status = 200;
    res.end();
    return;
  }

  console.log(req.url)
  if (req.url === '/upload') {
    controller.handleFormData(req, res);
  }

  if (req.url === '/verify') {
    await controller.handleVerifyUpload(req, res);
  }

  if (req.url === '/merge') {
    await controller.handleMerge(req, res);
  }
})

server.listen(8888, () => console.log("正在监听 8888 端口"))
