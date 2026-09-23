// infra/edge/nina-pm-viewer-request.js (CloudFront Functions Runtime 2.0), Wortlaut nach TK 4.3
function handler(event) {
  var req = event.request, uri = req.uri;
  if (uri.indexOf('/api/') === 0 || uri.indexOf('/catalog/') === 0 || uri.indexOf('/downloads/') === 0) return req;
  var last = uri.substring(uri.lastIndexOf('/') + 1);
  if (last.indexOf('.') === -1) req.uri = '/index.html';   // Client-Routen der SPA
  return req;
}
