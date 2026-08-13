// ===================================================
// Code.gs — Entry point, persistence and shared utilities
// ===================================================

const APP_SCHEMA = Object.freeze({
  Funcionarios: ['id', 'nome', 'email', 'senha_hash', 'perfil', 'ativo', 'criado_em'],
  Locais: ['id', 'nome', 'latitude', 'longitude', 'raio_metros', 'ativo', 'criado_em'],
  FuncionarioLocais: ['funcionario_id', 'local_id'],
  Registros: ['id', 'funcionario_id', 'nome', 'local_id', 'local_nome', 'tipo', 'latitude', 'longitude', 'timestamp', 'dispositivo'],
  Config: ['chave', 'valor'],
  Sessoes: ['token', 'funcionario_id', 'criado_em', 'expira_em'],
});

function doGet() {
  autoSetup();
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Projeto Ponto')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet(name) {
  if (!Object.prototype.hasOwnProperty.call(APP_SCHEMA, name)) {
    throw new Error('Aba inválida.');
  }
  const sheet = getSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error(`Aba ${name} não encontrada.`);
  return sheet;
}

function getData(sheetName) {
  const sheet = getSheet(sheetName);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow <= 1 || lastColumn === 0) return [];

  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values.shift().map(String);
  return values.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}

function appendRow(sheetName, rowData) {
  appendRows(sheetName, [rowData]);
}

function appendRows(sheetName, rows) {
  if (!rows || rows.length === 0) return;
  const sheet = getSheet(sheetName);
  const headers = APP_SCHEMA[sheetName];
  const values = rows.map(row => headers.map(header => row[header] !== undefined ? row[header] : ''));
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
}

function updateRowAt(sheetName, rowIndex, updates) {
  const sheet = getSheet(sheetName);
  const headers = APP_SCHEMA[sheetName];
  const range = sheet.getRange(rowIndex, 1, 1, headers.length);
  const row = range.getValues()[0];
  headers.forEach((header, index) => {
    if (Object.prototype.hasOwnProperty.call(updates, header)) row[index] = updates[header];
  });
  range.setValues([row]);
}

function replaceDataRows(sheetName, rows) {
  const sheet = getSheet(sheetName);
  const headers = APP_SCHEMA[sheetName];
  const currentRows = Math.max(0, sheet.getLastRow() - 1);
  if (currentRows > 0) sheet.getRange(2, 1, currentRows, headers.length).clearContent();
  if (rows.length > 0) {
    const values = rows.map(row => headers.map(header => row[header] !== undefined ? row[header] : ''));
    sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  }
}

function findRow(sheetName, key, value) {
  const rows = getData(sheetName);
  const index = rows.findIndex(row => String(row[key]) === String(value));
  return index < 0 ? null : { rowIndex: index + 2, obj: rows[index] };
}

function withScriptLock(callback, timeoutMs) {
  const lock = LockService.getScriptLock();
  lock.waitLock(timeoutMs || 10000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function isActive(value) {
  return value === true || String(value).toLowerCase() === 'true';
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function parseCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function formatTimestamp(date) {
  return Utilities.formatDate(date || new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function todayPrefix() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const radius = 6371000;
  const toRadians = degrees => degrees * Math.PI / 180;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLon = toRadians(lon2 - lon1);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getSessionUser(token) {
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const session = getData('Sessoes').find(item => constantTimeEquals(String(item.token), tokenHash));
  if (!session || !Number.isFinite(Date.parse(session.expira_em)) || new Date(session.expira_em) <= new Date()) return null;
  return getData('Funcionarios').find(user =>
    String(user.id) === String(session.funcionario_id) && isActive(user.ativo)
  ) || null;
}

function requireAdmin(token) {
  const user = getSessionUser(token);
  if (!user || user.perfil !== 'admin') throw new Error('Acesso negado.');
  return user;
}

function autoSetup() {
  withScriptLock(() => {
    const spreadsheet = getSpreadsheet();
    Object.entries(APP_SCHEMA).forEach(([name, headers]) => {
      let sheet = spreadsheet.getSheetByName(name);
      if (!sheet) sheet = spreadsheet.insertSheet(name);
      if (sheet.getLastRow() === 0) {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        sheet.getRange(1, 1, 1, headers.length)
          .setBackground('#1e3a5f').setFontColor('#ffffff').setFontWeight('bold');
        sheet.setFrozenRows(1);
      }
    });

    const configSheet = spreadsheet.getSheetByName('Config');
    if (configSheet.getLastRow() <= 1) {
      configSheet.getRange(2, 1, 2, 2).setValues([
        ['sessao_duracao_horas', '12'],
        ['app_nome', 'Projeto Ponto'],
      ]);
    }
  });
}

function getConfig(key) {
  const entry = getData('Config').find(item => String(item.chave) === String(key));
  return entry ? entry.valor : null;
}

function checkFirstRun() {
  autoSetup();
  return { firstRun: !getData('Funcionarios').some(user => user.perfil === 'admin') };
}

function getPublicAppInfo() {
  return {
    nome: String(getConfig('app_nome') || 'Projeto Ponto').slice(0, 80),
    versao: typeof APP_VERSION_DISPLAY === 'undefined' ? '' : APP_VERSION_DISPLAY,
  };
}
