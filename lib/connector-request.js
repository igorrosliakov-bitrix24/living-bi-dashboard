export function parseConnectorForm(raw) {
  const body = {};

  for (const [key, value] of new URLSearchParams(raw)) {
    const indexedMatch = key.match(/^([^\[]+)\[(\d+)\]$/);
    if (indexedMatch) {
      const [, name, index] = indexedMatch;
      const values = Array.isArray(body[name]) ? body[name] : [];
      values[Number(index)] = value;
      body[name] = values;
      continue;
    }

    const objectMatch = key.match(/^([^\[]+)\[([^\]]+)\]$/);
    if (objectMatch) {
      const [, name, property] = objectMatch;
      const values = body[name] && typeof body[name] === "object" && !Array.isArray(body[name]) ? body[name] : {};
      values[property] = value;
      body[name] = values;
      continue;
    }

    if (key.endsWith("[]")) {
      const name = key.slice(0, -2);
      body[name] = [...(body[name] || []), value];
      continue;
    }

    body[key] = value;
  }

  return body;
}
