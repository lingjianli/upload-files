function $(domName) {
  if (domName.includes('#')) {
    return document.getElementById(domName.slice(1));
  }
}

function request({
  url, 
  data,
  method = "POST",
  headers = {},
  onProgress = e => e,
  requestList
}) {
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = onProgress;
    xhr.open(method, url);
    Object.keys(headers).forEach(key => {
      xhr.setRequestHeader(key, headers[key]);
    });
    xhr.send(data);

    xhr.onload = e => {
      if (requestList) {
        const xhrIndex = requestList.indexOf(xhr);
        requestList.splice(xhrIndex, 1);
      }
      resolve({
        data: e.target.response
      });
    };

    requestList?.push(xhr)
  })
}