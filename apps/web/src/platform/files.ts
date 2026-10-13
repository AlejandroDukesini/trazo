import { platform } from './index';

/**
 * Guarda un archivo generado por la app.
 * - Web: descarga del navegador.
 * - Windows (Tauri): diálogo nativo "Guardar como".
 * - Android: escribe en Documentos y abre el panel de compartir.
 */
export async function saveFile(name: string, blob: Blob): Promise<void> {
  if (platform === 'windows') {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const ext = name.split('.').pop() ?? '*';
    const path = await save({ defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return;
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return;
  }
  if (platform === 'android') {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const data = await blobToBase64(blob);
    const res = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache });
    await Share.share({ title: name, url: res.uri });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Comparte un enlace con el panel nativo si existe; si no, lo copia al portapapeles. */
export async function shareLink(title: string, url: string): Promise<'shared' | 'copied'> {
  if (platform === 'android') {
    const { Share } = await import('@capacitor/share');
    await Share.share({ title, url });
    return 'shared';
  }
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return 'shared';
    } catch {
      /* cancelado: se copia */
    }
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}
