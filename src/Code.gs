// ===================================================
// Code.gs — Entry Point & Shared Utilities
// Projeto Ponto | Google Apps Script Web App
// ===================================================
// Deploy: Publicar > Implantar como App da Web
//   - Executar como: Eu (usuário que implanta)
//   - Quem tem acesso: Qualquer pessoa
// ===================================================

function doGet(e) {
  autoSetup(); // Initialize spreadsheet on first access
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Projeto Ponto')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ── Spreadsheet ──────────────────────────────────────────────

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet(name) {
  return getSpreadsheet().getSheetByName(name);
}

function getData(sheetName) {
  const sheet = getSheet(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

function appendRow(sheetName, rowData) {
  const sheet = getSheet(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.appendRow(headers.map(h => (rowData[h] !== undefined ? rowData[h] : '')));
}

function updateRowAt(sheetName, rowIndex, updates) {
  const sheet = getSheet(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  headers.forEach((h, i) => {
    if (updates[h] !== undefined) {
      sheet.getRange(rowIndex, i + 1).setValue(updates[h]);
    }
  });
}

function findRow(sheetName, key, value) {
  const sheet = getSheet(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return null;
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const colIdx = headers.indexOf(key);
  if (colIdx === -1) return null;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][colIdx]) === String(value)) {
      const obj = {};
      headers.forEach((h, j) => { obj[h] = values[i][j]; });
      return { rowIndex: i + 1, obj };
    }
  }
  return null;
}

// ── Haversine (meters) ───────────────────────────────────────

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
    * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Session ──────────────────────────────────────────────────

function getSessionUser(token) {
  if (!token) return null;
  const sessoes = getData('Sessoes');
  const sessao = sessoes.find(s => s.token === String(token));
  if (!sessao) return null;
  if (new Date(sessao.expira_em) < new Date()) return null;
  const user = getData('Funcionarios').find(
    f => String(f.id) === String(sessao.funcionario_id) && f.ativo === true
  );
  return user || null;
}

function requireAdmin(token) {
  const user = getSessionUser(token);
  if (!user || user.perfil !== 'admin') {
    throw new Error('Acesso negado. Permissão de administrador necessária.');
  }
  return user;
}

// ── Auto-Setup (runs on every doGet, idempotent) ─────────────

function autoSetup() {
  const ss = getSpreadsheet();
  const schema = {
    Funcionarios:      ['id', 'nome', 'email', 'senha_hash', 'perfil', 'ativo', 'criado_em'],
    Locais:            ['id', 'nome', 'latitude', 'longitude', 'raio_metros', 'ativo', 'criado_em'],
    FuncionarioLocais: ['funcionario_id', 'local_id'],
    Registros:         ['id', 'funcionario_id', 'nome', 'local_id', 'local_nome', 'tipo', 'latitude', 'longitude', 'timestamp', 'dispositivo'],
    Config:            ['chave', 'valor'],
    Sessoes:           ['token', 'funcionario_id', 'criado_em', 'expira_em'],
  };
  for (const [name, headers] of Object.entries(schema)) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length)
        .setBackground('#1e3a5f').setFontColor('#ffffff').setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }
  // Seed default config values if Config is empty
  const configSheet = ss.getSheetByName('Config');
  if (configSheet.getLastRow() <= 1) {
    const defaults = [
      ['sessao_duracao_horas', '12'],
      ['app_nome', 'Projeto Ponto'],
    ];
    defaults.forEach(row => configSheet.appendRow(row));
  }
}

// ── Config ───────────────────────────────────────────────────

function getConfig(chave) {
  const configs = getData('Config');
  const entry = configs.find(c => c.chave === chave);
  return entry ? entry.valor : null;
}

// Called by client to check if first-run setup is needed
function checkFirstRun() {
  autoSetup();
  const funcionarios = getData('Funcionarios');
  const hasAdmin = funcionarios.some(f => f.perfil === 'admin');
  return { firstRun: !hasAdmin };
}
