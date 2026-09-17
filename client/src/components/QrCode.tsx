import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** 초대 링크를 작은 QR코드로 보여줌. 순수 자체 생성 SVG라 innerHTML 주입이 안전함. */
export function QrCode({ text }: { text: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ scalable: true });
  }, [text]);

  return <div className="qr-code" dangerouslySetInnerHTML={{ __html: svg }} />;
}
