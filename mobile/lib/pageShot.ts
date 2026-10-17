export function pictureDataUrl(blob: Blob): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(blob.type) || blob.size > 8_000_000) {
    return Promise.reject(new Error("Could not display this page picture."));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read this page picture."));
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read this page picture."));
    reader.readAsDataURL(blob);
  });
}
