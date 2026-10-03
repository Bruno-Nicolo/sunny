const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>',
  '<< /Length 0 >>\nstream\n\nendstream'
]
let pdf = '%PDF-1.7\n'
const offsets = [0]
for (const [index, object] of objects.entries()) {
  offsets.push(pdf.length)
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
}
const xref = pdf.length
pdf += `xref\n0 5\n0000000000 65535 f \n${offsets
  .slice(1)
  .map((x) => `${String(x).padStart(10, '0')} 00000 n \n`)
  .join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`

export const blankPdf = new Uint8Array(Buffer.from(pdf))
