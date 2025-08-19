const chunks = [];
const moduleSearches: { filter: (module: any) => boolean, resolve: (value: unknown) => any }[] = [];

export const moduleFilters = {
  'backend': (module: any) => module && findExport(module, prop => prop && prop.url && prop.url.includes && prop.url.includes('backend.wplace.live')),
  'svelte': (module: any) => module && findExport(module, prop => prop && prop.toString && prop.toString().includes('window.__svelte'))
}

export function findModule(filter: (module: any) => boolean) {
  return new Promise(resolve => {
    for (const chunk of chunks) {
      if (!filter(chunk))
        continue;
      if (!resolve) {
        console.warn('multiple modules found that match the same filter!', filter, chunk);
        continue;
      }
      resolve(chunk);
      resolve = undefined;
    }
    moduleSearches.push({ filter, resolve });
  });
}

export function findExportName(module: any, filter: (prop: any) => boolean) {
  let res = null;
  for (const prop in module) {
    if (!filter(module[prop]))
      continue;
    if (res) {
      console.warn('multiple props found that match the same filter!', filter, module[res], module[prop]);
      continue;
    }
    res = prop;
  }
  return res;
}

export function findExport(module: any, filter: (prop: any) => boolean) {
  const res = findExportName(module, filter);
  return res ? module[res] : res;
}

document.addEventListener('DOMContentLoaded', () => {
  const links = document.head.getElementsByTagName('link');
  for (let i = 0; i < links.length; i++) {
    const link = links.item(i);
    if (link.rel !== 'modulepreload')
      continue;
    const href = link.href;
    if (!href.includes('chunk'))
      continue;
    import(href).then(chunk => {
      chunks.push(chunk);
      for (const search of moduleSearches) {
        if (!search.filter(chunk))
          continue;
        if (!search.resolve) {
          console.warn('multiple modules found that match the same filter!', chunk);
          continue;
        }
        search.resolve(chunk);
        search.resolve = undefined;
      }
    });
  }
});
