export async function startCamera(video, { width = 640, height = 480 } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width, height },
  });
  video.srcObject = stream;
  await new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      resolve();
    };
  });
  return stream;
}
