function log(type, content) {
  // https://jupyter-client.readthedocs.io/en/stable/messaging.html#messages-on-the-iopub-pub-sub-channel
  host = document.getElementById("console");
  if (type == "execute_input") {
    var node = document.createElement("pre");
    node.innerText = content["code"];
    node.className = type;
    host.appendChild(node);
  } else if (type == 'error') {
    var node = document.createElement("pre");
    node.innerText = content['ename'] + ': ' + content["evalue"];
    node.className = type;
    host.appendChild(node);
  } else if (type == "stream") {
    var node = document.createElement("pre");
    node.innerText = content["text"];
    node.className = type;
    host.appendChild(node);
  } else if (type == "execute_result" || type == "display_data") {
    Object.keys(content["data"]).forEach(function (key) {
      if (key == "text/plain") {
        var node = document.createElement("pre");
        node.innerText = content["data"][key];
        node.className = type;
        host.appendChild(node);
      } else if (key == "text/html") {
        var node = document.createElement("div");
        node.innerHTML = content["data"][key];
        node.className = type;
        host.appendChild(node);
      } else if ((key == "image/png") || (key == 'image/svg+xml')) {
        src = "data:" + key + ";base64," + content["data"][key];
        var node = document.createElement("img");
        node.src = src;
        host.appendChild(node);
      }
      //console.log(key, content["data"][key]);
    });
  }
  window.scrollTo(0, document.body.scrollHeight);
}

var ws = new WebSocket("ws://127.0.0.1:8765");
ws.onmessage = function (ev) {
  msg = JSON.parse(ev["data"]);
  log(msg["msg_type"], msg["content"]);
  //console.log(ev["data"]);
};
