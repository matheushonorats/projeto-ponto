// ===================================================
// Auth.gs — Authentication and session management
// ===================================================

const PASSWORD_VERSION = 'v2';
const PASSWORD_ITERATIONS = 12000;
const SESSION_HOURS_DEFAULT = 12;
const SESSION_HOURS_MAX = 72;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_BLOCK_SECONDS = 15 * 60;

function bytesToHex(bytes) {
  return bytes.map(byte => (`0${(byte & 0xff).toString(16)}`).slice(-2)).join('');
}

function sha256(value) {
  return bytesToHex(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  ));
}

function hashPassword(password, salt) {
  const passwordSalt = salt || Utilities.getUuid().replace(/-/g, '');
  let digest = `${passwordSalt}:${String(password)}`;
  for (let index = 0; index < PASSWORD_ITERATIONS; index += 1) {
    digest = sha256(`${digest}:${passwordSalt}:${index}`);
  }
  return `${PASSWORD_VERSION}$${PASSWORD_ITERATIONS}$${passwordSalt}$${digest}`;
}

function verifyPassword(password, storedHash) {
  const stored = String(storedHash || '');
  if (!stored.startsWith(`${PASSWORD_VERSION}$`)) {
    return constantTimeEquals(sha256(password), stored);
  }
  const parts = stored.split('$');
  if (parts.length !== 4 || Number(parts[1]) !== PASSWORD_ITERATIONS) return false;
  return constantTimeEquals(hashPassword(password, parts[2]), stored);
}

function constantTimeEquals(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index % Math.max(a.length, 1)) || 0)
      ^ (b.charCodeAt(index % Math.max(b.length, 1)) || 0);
  }
  return mismatch === 0;
}

function generateToken() {
  return `${Utilities.getUuid()}${Utilities.getUuid()}`.replace(/-/g, '');
}

function hashSessionToken(token) {
  return sha256(`session:${String(token || '')}`);
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 10) return 'A senha deve ter pelo menos 10 caracteres.';
  if (value.length > 128) return 'A senha deve ter no máximo 128 caracteres.';
  return null;
}

function loginRateKey(email) {
  return `login:${sha256(normalizeEmail(email)).slice(0, 32)}`;
}

function getLoginAttempts(email) {
  return Number(CacheService.getScriptCache().get(loginRateKey(email)) || 0);
}

function recordFailedLogin(email) {
  const cache = CacheService.getScriptCache();
  const attempts = getLoginAttempts(email) + 1;
  cache.put(loginRateKey(email), String(attempts), LOGIN_BLOCK_SECONDS);
  return attempts;
}

function clearLoginAttempts(email) {
  CacheService.getScriptCache().remove(loginRateKey(email));
}

function criarAdminInicial(nome, email, senha) {
  try {
    return withScriptLock(() => {
      if (getData('Funcionarios').some(user => user.perfil === 'admin')) {
        return { success: false, error: 'A configuração inicial já foi concluída.' };
      }

      const normalizedEmail = normalizeEmail(email);
      const passwordError = validatePassword(senha);
      if (!String(nome || '').trim() || !isValidEmail(normalizedEmail)) {
        return { success: false, error: 'Informe nome e e-mail válidos.' };
      }
      if (passwordError) return { success: false, error: passwordError };

      appendRow('Funcionarios', {
        id: `ADM-${Utilities.getUuid().slice(0, 8).toUpperCase()}`,
        nome: String(nome).trim().slice(0, 120),
        email: normalizedEmail,
        senha_hash: hashPassword(senha),
        perfil: 'admin',
        ativo: true,
        criado_em: new Date().toISOString(),
      });
      return { success: true, message: 'Administrador criado. Você já pode entrar.' };
    });
  } catch (error) {
    return { success: false, error: 'Não foi possível concluir a configuração inicial.' };
  }
}

function login(email, senha) {
  const normalizedEmail = normalizeEmail(email);
  try {
    if (!isValidEmail(normalizedEmail) || !senha) {
      return { success: false, error: 'E-mail ou senha incorretos.' };
    }
    if (getLoginAttempts(normalizedEmail) >= LOGIN_MAX_ATTEMPTS) {
      return { success: false, error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' };
    }

    const found = getData('Funcionarios').find(user => normalizeEmail(user.email) === normalizedEmail);
    if (!found || !isActive(found.ativo) || !verifyPassword(senha, found.senha_hash)) {
      recordFailedLogin(normalizedEmail);
      return { success: false, error: 'E-mail ou senha incorretos.' };
    }

    return withScriptLock(() => {
      const current = findRow('Funcionarios', 'id', found.id);
      if (!current || !isActive(current.obj.ativo)) return { success: false, error: 'E-mail ou senha incorretos.' };

      // Transparently migrate legacy unsalted SHA-256 hashes after a valid login.
      if (!String(current.obj.senha_hash).startsWith(`${PASSWORD_VERSION}$`)) {
        updateRowAt('Funcionarios', current.rowIndex, { senha_hash: hashPassword(senha) });
      }

      const token = generateToken();
      const now = new Date();
      const configuredHours = Number(getConfig('sessao_duracao_horas'));
      const durationHours = Number.isFinite(configuredHours)
        ? Math.min(Math.max(configuredHours, 1), SESSION_HOURS_MAX)
        : SESSION_HOURS_DEFAULT;

      appendRow('Sessoes', {
        token: hashSessionToken(token),
        funcionario_id: current.obj.id,
        criado_em: now.toISOString(),
        expira_em: new Date(now.getTime() + durationHours * 3600000).toISOString(),
      });
      cleanExpiredSessionsUnsafe();
      clearLoginAttempts(normalizedEmail);
      return { success: true, token, nome: current.obj.nome, perfil: current.obj.perfil };
    });
  } catch (error) {
    console.error('login', error);
    return { success: false, error: 'Não foi possível entrar agora. Tente novamente.' };
  }
}

function logout(token) {
  try {
    if (!token) return { success: true };
    withScriptLock(() => {
      const tokenHash = hashSessionToken(token);
      replaceDataRows('Sessoes', getData('Sessoes').filter(session => !constantTimeEquals(session.token, tokenHash)));
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: 'Não foi possível encerrar a sessão.' };
  }
}

function validateToken(token) {
  const user = getSessionUser(token);
  return user ? { valid: true, nome: user.nome, perfil: user.perfil } : { valid: false };
}

function alterarSenha(token, senhaAtual, novaSenha) {
  try {
    const user = getSessionUser(token);
    if (!user) return { success: false, error: 'Sessão inválida.' };
    if (!verifyPassword(senhaAtual, user.senha_hash)) return { success: false, error: 'Senha atual incorreta.' };
    const passwordError = validatePassword(novaSenha);
    if (passwordError) return { success: false, error: passwordError };

    return withScriptLock(() => {
      const found = findRow('Funcionarios', 'id', user.id);
      if (!found) return { success: false, error: 'Usuário não encontrado.' };
      updateRowAt('Funcionarios', found.rowIndex, { senha_hash: hashPassword(novaSenha) });
      invalidateUserSessionsUnsafe(user.id);
      return { success: true, message: 'Senha alterada. Entre novamente.', requireLogin: true };
    });
  } catch (error) {
    return { success: false, error: 'Não foi possível alterar a senha.' };
  }
}

function invalidateUserSessionsUnsafe(userId) {
  replaceDataRows('Sessoes', getData('Sessoes').filter(session => String(session.funcionario_id) !== String(userId)));
}

function cleanExpiredSessionsUnsafe() {
  const now = Date.now();
  replaceDataRows('Sessoes', getData('Sessoes').filter(session => {
    const expiration = Date.parse(session.expira_em);
    return Number.isFinite(expiration) && expiration > now;
  }));
}

function cleanExpiredSessions() {
  try {
    withScriptLock(cleanExpiredSessionsUnsafe);
  } catch (error) {
    console.error('cleanExpiredSessions', error);
  }
}
