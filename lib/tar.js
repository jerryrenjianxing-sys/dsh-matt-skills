/**
 * Minimal tar reader.
 *
 * Deliberately dependency-free and read-only: the plugin runs inside the DSH
 * process, where adding a tar/gzip dependency to a bundle is a liability. It
 * handles the two shapes upstream actually emits — plain ustar headers, and the
 * GNU long-name / pax metadata records that appear when a path exceeds 100 bytes.
 *
 * Directories are returned too (type '5') so callers can tell an empty directory
 * apart from a missing one, but file contents are the only thing anyone reads.
 */
import { gunzipSync } from 'node:zlib';

function cstr(buf, start, length) {
  const slice = buf.subarray(start, start + length);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul === -1 ? slice.length : nul).toString('utf8');
}

export function untarGz(buffer) {
  return untar(gunzipSync(buffer));
}

export function untar(buffer) {
  const entries = [];
  let offset = 0;
  let longName;

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = cstr(header, 0, 100);
    const size = Number.parseInt(cstr(header, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = cstr(header, 345, 155);
    const data = buffer.subarray(offset + 512, offset + 512 + size);
    const next = offset + 512 + Math.ceil(size / 512) * 512;

    if (type === 'L') {
      longName = data.toString('utf8').replace(/\0+$/, '');
      offset = next;
      continue;
    }
    if (type === 'x' || type === 'g') {
      offset = next;
      continue;
    }

    const full = prefix ? `${prefix}/${name}` : name;
    entries.push({ name: longName ?? full, type, size, data });
    longName = undefined;
    offset = next;
  }

  return entries;
}
