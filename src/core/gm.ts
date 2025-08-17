export const NATIVE_FETCH = window.fetch;

export const gmGet = (key: string, def: any) => {
  try {
    if (typeof GM !== 'undefined' && typeof GM.getValue === 'function') return GM.getValue(key, def);
    if (typeof GM_getValue === 'function') return Promise.resolve(GM_getValue(key, def));
  } catch {}
  return Promise.resolve(def);
};

export const gmSet = (key: string, value: any) => {
  try {
    if (typeof GM !== 'undefined' && typeof GM.setValue === 'function') return GM.setValue(key, value);
    if (typeof GM_setValue === 'function') return Promise.resolve(GM_setValue(key, value));
  } catch {}
  return Promise.resolve();
};

export function gmFetchBlob(url: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'blob',
        onload: (res) => {
          if (res.status >= 200 && res.status < 300 && res.response) resolve(res.response as Blob);
          else reject(new Error(`GM_xhr failed: ${res.status} ${res.statusText}`));
        },
        onerror: () => reject(new Error('GM_xhr network error')),
        ontimeout: () => reject(new Error('GM_xhr timeout')),
      });
    } catch (e) { reject(e); }
  });
}

export function gmFetchJson(url: string): Promise<object> {
  return new Promise((resolve, reject) => {
    try {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'json',
        onload: (res) => {
          if (res.status >= 200 && res.status < 300 && res.response) resolve(res.response);
          else reject(new Error(`GM_xhr failed: ${res.status} ${res.statusText}`));
        },
        onerror: () => reject(new Error('GM_xhr network error')),
        ontimeout: () => reject(new Error('GM_xhr timeout')),
      });
    } catch (e) { reject(e); }
  });
}

export function blobToDataURL(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

export async function urlToDataURL(url: string) {
  const blob = await gmFetchBlob(url);
  if (!blob || !String(blob.type).startsWith('image/')) throw new Error('URL did not return an image blob');
  return await blobToDataURL(blob);
}

export function fileToDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
