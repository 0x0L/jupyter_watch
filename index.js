var ws = new WebSocket("ws://127.0.0.1:8765");
function log(type, content) {
  if (type == "execute_input") {
    var node = document.createElement("div");
    node.textContent = "> " + content["code"];
    node.className = type;
    document.getElementById("console").appendChild(node);
  } else if (type == "stream") {
    var node = document.createElement("div");
    node.textContent = content["text"];
    node.className = type;
    document.getElementById("console").appendChild(node);
  } else if (type == "execute_result" || type == "display_data") {
    Object.keys(content["data"]).forEach(function (key) {
      if (key == "text/plain") {
        var node = document.createElement("div");
        node.textContent = content["data"][key];
        node.className = type;
        document.getElementById("console").appendChild(node);
      } else if (key == "image/png") {
        src = "data:" + key + ";base64," + content["data"][key];
        var node = document.createElement("img");
        node.src = src;
        document.getElementById("console").appendChild(node);
      }
      //console.log(key, content["data"][key]);
    });
  }
  window.scrollTo(0, document.body.scrollHeight);
  // else {"msg_type": "status", "content": {"execution_state": "idle"}} / busy
  // {"msg_type": "error", "content": {"traceback": ["\u001b[0;31m..."], "ename": "NameError", "evalue": "name 'z' is not defined"}}
  // https://jupyter-client.readthedocs.io/en/stable/messaging.html#messages-on-the-iopub-pub-sub-channel
}
ws.onmessage = function (ev) {
  msg = JSON.parse(ev["data"]);
  log(msg["msg_type"], msg["content"]);
  //console.log(ev["data"]);
};
