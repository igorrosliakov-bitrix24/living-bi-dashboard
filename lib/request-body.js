export class RequestBodyError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export async function readJsonBody(req, maxBytes = 50_000) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;

    if (size > maxBytes) {
      throw new RequestBodyError("body_too_large", "Изменение слишком большое.");
    }

    chunks.push(buffer);
  }

  if (size === 0) {
    throw new RequestBodyError("empty_body", "Передайте JSON со спецификацией отчёта.");
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestBodyError("invalid_json", "Не удалось прочитать JSON изменения.");
  }
}
