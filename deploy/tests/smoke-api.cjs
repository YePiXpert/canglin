// Run with `docker exec -i <isolated-server-container> node < this-file`.
// The container must use empty disposable storage and have no external network.
const assert = require('node:assert/strict');
let cookie = '';
async function call(method, route, data, expected = 200) {
  const response = await fetch('http://127.0.0.1:3000/api' + route, {
    method,
    headers: { cookie, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  assert.equal(response.status, expected, `${method} ${route}: ${await response.clone().text()}`);
  const text = await response.text();
  return {
    value: text ? JSON.parse(text) : null,
    cookie: response.headers.get('set-cookie')?.split(';')[0],
  };
}
(async () => {
  for (let n = 0; n < 60; n++) {
    try {
      if ((await fetch('http://127.0.0.1:3000/api/health')).ok) break;
    } catch {}
    if (n === 59) throw new Error('API failed to start');
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal((await call('GET', '/health')).value.database, true);
  const password = 'isolated-container-smoke';
  await call('POST', '/auth/setup', { password }, 201);
  cookie = (await call('POST', '/auth/login', { password })).cookie;
  const original = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  );
  const form = new FormData();
  form.append('file', new Blob([original], { type: 'image/png' }), 'smoke.png');
  const upload = await fetch('http://127.0.0.1:3000/api/imports/upload', {
    method: 'POST',
    headers: { cookie },
    body: form,
  });
  assert.equal(upload.status, 201);
  const { taskId } = await upload.json();
  // An image needs no OCR call to count its pages, so the unreachable OCR leaves the task
  // settled with page 1 unrecognized: it must be reviewed by hand before confirmation.
  let task;
  for (let n = 0; n < 40; n++) {
    task = (await call('GET', `/imports/tasks/${taskId}`)).value;
    const busy = [task.status, task.aiStatus].some((s) => s === 'PENDING' || s === 'RUNNING');
    if (!busy && task.reviewPages.some((p) => p.page === 1 && !p.reviewed)) break;
    if (n === 39) throw new Error('Offline OCR failure not visible');
    await new Promise((r) => setTimeout(r, 100));
  }
  const draft = {
    serialNumber: 'OA-CONTAINER',
    department: '测试部门',
    handler: '测试',
    requestDate: '2026-09-27',
    items: [{ lineId: 'manual-row', itemName: '容器样本', quantity: 4, unit: '件' }],
    reviewedPages: [{ page: 1, note: '已核对原件全部页面' }],
    reviewedAi: [],
  };
  const { version } = (
    await call('PUT', `/imports/tasks/${taskId}/draft`, { version: task.version, draft })
  ).value;
  // The confirmation creates the request and attaches the original in one transaction.
  const confirmed = (
    await call('POST', '/workflow/imports/confirm', { ...draft, taskId, version }, 201)
  ).value;
  assert.equal(confirmed.created, 1);
  assert.equal(confirmed.attached, 1);
  const id = confirmed.requestId;
  const [line] = (await call('GET', `/workflow/requests/${id}`)).value.lines;
  const backup = (await call('POST', '/system/backups', {}, 201)).value;
  // A change made after the backup must be rolled back by the restore.
  await call(
    'POST',
    '/workflow/request-cancellations',
    {
      date: draft.requestDate,
      reason: '备份后的改动',
      lines: [{ requestLineId: line.id, quantity: 1 }],
    },
    201,
  );
  await call('POST', `/system/backups/${backup.name}/restore`, {});
  await call('GET', '/workflow/requests', undefined, 401);
  cookie = (await call('POST', '/auth/login', { password })).cookie;
  const request = (await call('GET', `/workflow/requests/${id}`)).value;
  assert.equal(request.serialNumber, draft.serialNumber);
  assert.equal(request.sourceTaskId, taskId);
  // Quantities are fixed-point decimal strings.
  assert.deepEqual(
    request.lines.map((l) => [l.itemName, l.unit, l.quantity, l.cancelledQuantity]),
    [['容器样本', '件', '4', '0']],
  );
  const recovered = await fetch(`http://127.0.0.1:3000/api/imports/tasks/${taskId}/original`, {
    headers: { cookie },
  });
  assert.equal(recovered.status, 200);
  assert.deepEqual(Buffer.from(await recovered.arrayBuffer()), original);
  console.log(
    JSON.stringify({
      api: true,
      database: true,
      offlineManualImport: true,
      originalRestored: true,
      sessionInvalidated: true,
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
