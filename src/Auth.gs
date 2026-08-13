// ===================================================
// Auth.gs — Authentication & Session Management
// ===================================================

function hashPassword(senha) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(senha),
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

function generateToken() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

// ── First-run admin creation (no token required) ─────────────

function criarAdminInicial(nome, email, senha) {
  try {
    const funcionarios = getData('Funcionarios');
    if (funcionarios.some(f => f.perfil === 'admin')) {
      return { success: false, error: 'Já existe um administrador cadastrado.' };
    }
    if (!nome || !email || !senha) {
      return { success: false, error: 'Todos os campos são obrigatórios.' };
    }
    if (senha.length < 6) {
      return { success: false, error: 'Senha deve ter pelo menos 6 caracteres.' };
    }
    const id = 'ADM-' + Utilities.getUuid().substring(0, 8).toUpperCase();
    appendRow('Funcionarios', {
      id,
      nome: nome.trim(),
      email: email.toLowerCase().trim(),
      senha_hash: hashPassword(senha),
      perfil: 'admin',
      ativo: true,
      criado_em: new Date().toISOString(),
    });
    return { success: true, message: 'Administrador criado com sucesso! Faça login.' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Login ────────────────────────────────────────────────────

function login(email, senha) {
  try {
    if (!email || !senha) {
      return { success: false, error: 'E-mail e senha são obrigatórios.' };
    }
    const user = getData('Funcionarios').find(
      f => f.email.toLowerCase().trim() === email.toLowerCase().trim()
    );
    if (!user) return { success: false, error: 'E-mail ou senha incorretos.' };
    if (!user.ativo) return { success: false, error: 'Conta desativada. Contate o administrador.' };
    if (user.senha_hash !== hashPassword(senha)) return { success: false, error: 'E-mail ou senha incorretos.' };

    const token = generateToken();
    const agora = new Date();
    const duracaoHoras = Number(getConfig('sessao_duracao_horas')) || 12;
    const expiraEm = new Date(agora.getTime() + duracaoHoras * 3600000);

    appendRow('Sessoes', {
      token,
      funcionario_id: user.id,
      criado_em: agora.toISOString(),
      expira_em: expiraEm.toISOString(),
    });

    cleanExpiredSessions();

    return { success: true, token, nome: user.nome, perfil: user.perfil };
  } catch (e) {
    return { success: false, error: 'Erro ao fazer login: ' + e.message };
  }
}

// ── Logout ───────────────────────────────────────────────────

function logout(token) {
  try {
    const sheet = getSheet('Sessoes');
    if (!sheet || sheet.getLastRow() <= 1) return { success: true };
    const values = sheet.getDataRange().getValues();
    const headers = values[0];
    const colIdx = headers.indexOf('token');
    for (let i = values.length - 1; i >= 1; i--) {
      if (String(values[i][colIdx]) === String(token)) {
        sheet.deleteRow(i + 1);
        break;
      }
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Validate token (for client-side rehydration) ─────────────

function validateToken(token) {
  const user = getSessionUser(token);
  if (!user) return { valid: false };
  return { valid: true, nome: user.nome, perfil: user.perfil };
}

// ── Password change (self-service) ───────────────────────────

function alterarSenha(token, senhaAtual, novaSenha) {
  try {
    const user = getSessionUser(token);
    if (!user) return { success: false, error: 'Sessão inválida.' };
    if (user.senha_hash !== hashPassword(senhaAtual)) {
      return { success: false, error: 'Senha atual incorreta.' };
    }
    if (!novaSenha || novaSenha.length < 6) {
      return { success: false, error: 'A nova senha deve ter pelo menos 6 caracteres.' };
    }
    const found = findRow('Funcionarios', 'id', user.id);
    if (!found) return { success: false, error: 'Usuário não encontrado.' };
    updateRowAt('Funcionarios', found.rowIndex, { senha_hash: hashPassword(novaSenha) });
    return { success: true, message: 'Senha alterada com sucesso!' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Cleanup ──────────────────────────────────────────────────

function cleanExpiredSessions() {
  try {
    const sheet = getSheet('Sessoes');
    if (!sheet || sheet.getLastRow() <= 1) return;
    const values = sheet.getDataRange().getValues();
    const headers = values[0];
    const expIdx = headers.indexOf('expira_em');
    const agora = new Date();
    for (let i = values.length - 1; i >= 1; i--) {
      if (new Date(values[i][expIdx]) < agora) sheet.deleteRow(i + 1);
    }
  } catch (e) {
    Logger.log('cleanExpiredSessions: ' + e.message);
  }
}
