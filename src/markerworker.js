// Classic worker: runs the ArUco detector so the main thread keeps rendering at full speed.
importScripts('../lib/aruco/cv.js', '../lib/aruco/aruco.js');
const detector = new AR.Detector({ dictionaryName: 'ARUCO_MIP_36h12', maxHammingDistance: 6 });
onmessage = (e) => {
  const { w, h, buf } = e.data;
  let markers = [];
  try { markers = detector.detect({ width: w, height: h, data: new Uint8ClampedArray(buf) }).map((m) => ({ id: m.id, corners: m.corners.map((c) => ({ x: c.x, y: c.y })) })); } catch (err) { markers = []; }
  postMessage({ w, h, markers });
};
