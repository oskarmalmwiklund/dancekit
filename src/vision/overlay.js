// Canvas drawing: skeleton, keypoints, per-person labels.
// Ported from the original prototype.

const CONNECTIONS = [
  ['nose', 'left_eye'], ['left_eye', 'left_ear'], ['nose', 'right_eye'],
  ['right_eye', 'right_ear'], ['nose', 'left_shoulder'],
  ['nose', 'right_shoulder'], ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'], ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'], ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
];

export function drawPose(ctx, pose) {
  pose.keypoints.forEach((keypoint) => {
    if (keypoint.score > 0.3) {
      ctx.beginPath();
      ctx.arc(keypoint.x, keypoint.y, 4, 0, 2 * Math.PI);
      ctx.fillStyle = '#ff4d6d';
      ctx.fill();
      ctx.closePath();
    }
  });

  ctx.strokeStyle = '#c8ff3e';
  ctx.lineWidth = 2;
  CONNECTIONS.forEach(([first, second]) => {
    const a = pose.keypoints.find((kp) => kp.name === first);
    const b = pose.keypoints.find((kp) => kp.name === second);
    if (a && b && a.score > 0.3 && b.score > 0.3) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  });
}

export function drawLabelForPose(ctx, canvas, pose, text) {
  const nose = pose.keypoints.find((kp) => kp.name === 'nose' && kp.score > 0.3);
  const anchor = nose || { x: pose.keypoints[0]?.x || 10, y: pose.keypoints[0]?.y || 10 };
  const pad = 4;
  ctx.font = '12px "IBM Plex Mono", monospace';
  const metrics = ctx.measureText(text);
  const w = metrics.width + pad * 2;
  const h = 16 + pad * 2;
  const x = Math.min(Math.max(0, anchor.x + 10), canvas.width - w - 2);
  const y = Math.max(0, anchor.y - 28);

  ctx.fillStyle = 'rgba(10,10,15,0.7)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#e8e6df';
  ctx.fillText(text, x + pad, y + 13 + pad / 2);
}
