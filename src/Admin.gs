// ===================================================
// Admin.gs — Administrative operations
// ===================================================

function getDashboardStats(token) {
  try {
    requireAdmin(token);
    const todayRecords = getData('Registros')
      .filter(record => String(record.timestamp).startsWith(todayPrefix()))
      .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));

    const lastTypeByEmployee = new Map();
    todayRecords.forEach(record => lastTypeByEmployee.set(String(record.funcionario_id), record.tipo));
    const presentCount = [...lastTypeByEmployee.values()].filter(type => type !== 'saída').length;

    return {
      success: true,
      funcionariosAtivos: getData('Funcionarios').filter(user => isActive(user.ativo) && user.perfil === 'funcionario').length,
      locaisAtivos: getData('Locais').filter(location => isActive(location.ativo)).length,
      registrosHoje: todayRecords.length,
      presentesHoje: presentCount,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function getFuncionarios(token) {
  try {
    requireAdmin(token);
    const funcionarios = getData('Funcionarios').map(user => ({
      id: user.id,
      nome: user.nome,
      email: user.email,
      perfil: user.perfil,
      ativo: isActive(user.ativo),
      criado_em: user.criado_em,
    }));
    funcionarios.sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
    return { success: true, funcionarios };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function salvarFuncionario(token, dados) {
  try {
    const actor = requireAdmin(token);
    const input = dados || {};
    const name = String(input.nome || '').trim();
    const email = normalizeEmail(input.email);
    const profile = String(input.perfil || '');

    if (!name || name.length > 120 || !isValidEmail(email)) return { success: false, error: 'Informe nome e e-mail válidos.' };
    if (!['funcionario', 'admin'].includes(profile)) return { success: false, error: 'Perfil inválido.' };
    if (input.senha) {
      const passwordError = validatePassword(input.senha);
      if (passwordError) return { success: false, error: passwordError };
    }

    return withScriptLock(() => {
      const users = getData('Funcionarios');
      const duplicate = users.some(user => normalizeEmail(user.email) === email && String(user.id) !== String(input.id || ''));
      if (duplicate) return { success: false, error: 'E-mail já cadastrado.' };

      if (input.id) {
        const found = findRow('Funcionarios', 'id', input.id);
        if (!found) return { success: false, error: 'Funcionário não encontrado.' };
        const willBeActive = input.ativo !== false;
        const removingAdmin = found.obj.perfil === 'admin' && (profile !== 'admin' || !willBeActive);
        if (removingAdmin && activeAdminCount(users) <= 1) {
          return { success: false, error: 'O sistema precisa manter ao menos um administrador ativo.' };
        }

        const updates = { nome: name, email, perfil: profile, ativo: willBeActive };
        if (input.senha) updates.senha_hash = hashPassword(input.senha);
        updateRowAt('Funcionarios', found.rowIndex, updates);
        if (input.senha || !willBeActive || profile !== found.obj.perfil) invalidateUserSessionsUnsafe(found.obj.id);
        return { success: true, message: 'Funcionário atualizado.' };
      }

      const passwordError = validatePassword(input.senha);
      if (passwordError) return { success: false, error: passwordError };
      const id = `F${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd')}-${Utilities.getUuid().slice(0, 6).toUpperCase()}`;
      appendRow('Funcionarios', {
        id,
        nome: name,
        email,
        senha_hash: hashPassword(input.senha),
        perfil: profile,
        ativo: true,
        criado_em: new Date().toISOString(),
      });
      return { success: true, message: 'Funcionário cadastrado.', id };
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function activeAdminCount(users) {
  return users.filter(user => user.perfil === 'admin' && isActive(user.ativo)).length;
}

function toggleFuncionario(token, id) {
  try {
    const actor = requireAdmin(token);
    return withScriptLock(() => {
      const users = getData('Funcionarios');
      const found = findRow('Funcionarios', 'id', id);
      if (!found) return { success: false, error: 'Funcionário não encontrado.' };
      const newStatus = !isActive(found.obj.ativo);
      if (!newStatus && found.obj.perfil === 'admin' && activeAdminCount(users) <= 1) {
        return { success: false, error: 'O último administrador ativo não pode ser desativado.' };
      }
      updateRowAt('Funcionarios', found.rowIndex, { ativo: newStatus });
      if (!newStatus) invalidateUserSessionsUnsafe(found.obj.id);
      return { success: true, ativo: newStatus, message: newStatus ? 'Funcionário ativado.' : 'Funcionário desativado.' };
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function resetSenhaFuncionario(token, funcionarioId, novaSenha) {
  try {
    requireAdmin(token);
    const passwordError = validatePassword(novaSenha);
    if (passwordError) return { success: false, error: passwordError };
    return withScriptLock(() => {
      const found = findRow('Funcionarios', 'id', funcionarioId);
      if (!found) return { success: false, error: 'Funcionário não encontrado.' };
      updateRowAt('Funcionarios', found.rowIndex, { senha_hash: hashPassword(novaSenha) });
      invalidateUserSessionsUnsafe(funcionarioId);
      return { success: true, message: 'Senha redefinida. As sessões anteriores foram encerradas.' };
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function getLocais(token) {
  try {
    requireAdmin(token);
    const locais = getData('Locais').map(location => ({ ...location, ativo: isActive(location.ativo) }));
    locais.sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
    return { success: true, locais };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function salvarLocal(token, dados) {
  try {
    requireAdmin(token);
    const input = dados || {};
    const name = String(input.nome || '').trim();
    const latitude = parseCoordinate(input.latitude, -90, 90);
    const longitude = parseCoordinate(input.longitude, -180, 180);
    const radius = Number(input.raio_metros);
    if (!name || name.length > 120) return { success: false, error: 'Informe um nome válido.' };
    if (latitude === null || longitude === null) return { success: false, error: 'Coordenadas inválidas.' };
    if (!Number.isInteger(radius) || radius < 10 || radius > 10000) return { success: false, error: 'O raio deve estar entre 10 e 10.000 metros.' };

    return withScriptLock(() => {
      if (input.id) {
        const found = findRow('Locais', 'id', input.id);
        if (!found) return { success: false, error: 'Local não encontrado.' };
        updateRowAt('Locais', found.rowIndex, { nome: name, latitude, longitude, raio_metros: radius });
        return { success: true, message: 'Local atualizado.' };
      }
      const id = `L${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd')}-${Utilities.getUuid().slice(0, 6).toUpperCase()}`;
      appendRow('Locais', { id, nome: name, latitude, longitude, raio_metros: radius, ativo: true, criado_em: new Date().toISOString() });
      return { success: true, message: 'Local cadastrado.', id };
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function toggleLocal(token, id) {
  try {
    requireAdmin(token);
    return withScriptLock(() => {
      const found = findRow('Locais', 'id', id);
      if (!found) return { success: false, error: 'Local não encontrado.' };
      const ativo = !isActive(found.obj.ativo);
      updateRowAt('Locais', found.rowIndex, { ativo });
      return { success: true, ativo };
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function getLocaisFuncionario(token, funcionarioId) {
  try {
    requireAdmin(token);
    const ids = getData('FuncionarioLocais')
      .filter(link => String(link.funcionario_id) === String(funcionarioId))
      .map(link => String(link.local_id));
    return { success: true, local_ids: ids };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function setLocaisFuncionario(token, funcionarioId, locaisIds) {
  try {
    requireAdmin(token);
    return withScriptLock(() => {
      if (!findRow('Funcionarios', 'id', funcionarioId)) return { success: false, error: 'Funcionário não encontrado.' };
      const validLocations = new Set(getData('Locais').map(location => String(location.id)));
      const selected = [...new Set((locaisIds || []).map(String))];
      if (selected.some(id => !validLocations.has(id))) return { success: false, error: 'Um dos locais selecionados é inválido.' };

      const otherLinks = getData('FuncionarioLocais').filter(link => String(link.funcionario_id) !== String(funcionarioId));
      const newLinks = selected.map(localId => ({ funcionario_id: funcionarioId, local_id: localId }));
      replaceDataRows('FuncionarioLocais', otherLinks.concat(newLinks));
      return { success: true, message: 'Locais atualizados.' };
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function getRelatorio(token, dataInicio, dataFim, funcionarioId, localId) {
  try {
    requireAdmin(token);
    let records = filterRecords(getData('Registros'), dataInicio, dataFim);
    if (funcionarioId) records = records.filter(record => String(record.funcionario_id) === String(funcionarioId));
    if (localId) records = records.filter(record => String(record.local_id) === String(localId));
    records.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    return { success: true, registros: records.slice(0, 500) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function getConfiguracoes(token) {
  try {
    requireAdmin(token);
    return { success: true, config: Object.fromEntries(getData('Config').map(item => [item.chave, item.valor])) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function salvarConfiguracao(token, chave, valor) {
  try {
    requireAdmin(token);
    const allowed = new Set(['sessao_duracao_horas', 'app_nome']);
    if (!allowed.has(String(chave))) return { success: false, error: 'Configuração inválida.' };
    let normalizedValue = String(valor || '').trim();
    if (chave === 'sessao_duracao_horas') {
      const hours = Number(normalizedValue);
      if (!Number.isInteger(hours) || hours < 1 || hours > SESSION_HOURS_MAX) return { success: false, error: 'A duração deve estar entre 1 e 72 horas.' };
      normalizedValue = String(hours);
    } else if (!normalizedValue || normalizedValue.length > 80) {
      return { success: false, error: 'Nome do app inválido.' };
    }

    return withScriptLock(() => {
      const found = findRow('Config', 'chave', chave);
      if (found) updateRowAt('Config', found.rowIndex, { valor: normalizedValue });
      else appendRow('Config', { chave, valor: normalizedValue });
      return { success: true };
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}
