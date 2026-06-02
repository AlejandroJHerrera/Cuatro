import QRCode from "qrcode";

export async function renderQrPng(payload: string): Promise<Buffer> {
  return QRCode.toBuffer(payload, {
    type: "png",
    errorCorrectionLevel: "M",
    width: 512,
    margin: 2,
    color: { dark: "#000000ff", light: "#ffffffff" },
  });
}
