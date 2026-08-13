// ===================================================
// Admin.gs — Admin Panel Operations
// ===================================================

// ── Dashboard ────────────────────────────────────────────────

function getDashboardStats(token) {
  try {
    requireAdmin(token);
    const tz = Session.getScriptTimeZone();
    const hoje = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    const registros = getData('Registros');
    const registrosHoje = registros.filter(r => String(r.timestamp).startsWith(hoje));
    const funcionarios = getData('Funcionarios');
    const locais = getData('Locais');

    return {
      success: true,
      funcionariosAtivos: funcionarios.filter(f => f.ativo === true && f.perfil === 'funcionario').length,
      locaisAtivos: locais.filter(l => l.ativo === true).length,
      registrosHoje: registrosHoje.length,
      presentesHoje: new Set(registrosHoje.filter(r => r.tipo === 'entrada').map(r => r.funcionario_id)).size,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Funcionários ─────────────────────────────────────────────

function getFuncionarios(token) {
  try {
    requireAdmin(token);
    const list = getData('Funcionarios').map(f => ({
      id: f.id, nome: f.nome, email: f.email,
      perfil: f.perfil, ativo: f.ativo, criado_em: f.criado_em,
    }));
    list.sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt'));
    return { success: true, funcionarios: list };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function salvarFuncionario(token, dados) {
  try {
    requireAdmin(token);
    const { id, nome, email, perfil, senha, ativo } = dados;
    if (!nome || !email) return { success: false, error: 'Nome e e-mail são obrigatórios.' };
    if (!['funcionario', 'admin'].includes(perfil)) return { success: false, error: 'Perfil inválido.' };

    const emailNorm = email.toLowerCase().trim();
    const todos = getData('Funcionarios');

    if (id) {
      // Update
      const dup = todos.find(f => f.email.toLowerCase().trim() === emailNorm && String(f.id) !== String(id));
      if (dup) return { success: false, error: 'E-mail já cadastrado para outro funcionário.' };
      const found = findRow('Funcionarios', 'id', id);
      if (!found) return { success: false, error: 'Funcionário não encontrado.' };
      const updates = { nome: nome.trim(), email: emailNorm, perfil, ativo: ativo !== false };
      if (senha && senha.length >= 6) updates.senha_hash = hashPassword(senha);
      else if (senha && senha.length > 0) return { success: false, error: 'Senha deve ter pelo menos 6 caracteres.' };
      updateRowAt('Funcionarios', found.rowIndex, updates);
      return { success: true, message: 'Funcionário atualizado com sucesso!' };
    } else {
      // Create
      if (todos.find(f => f.email.toLowerCase().trim() === emailNorm)) {
        return { success: false, error: 'E-mail já cadastrado.' };
      }
      if (!senha || senha.length < 6) return { success: false, error: 'Senha deve ter pelo menos 6 caracteres.' };
      const tz = Session.getScriptTimeZone();
      const newId = 'F' + Utilities.formatDate(new Date(), tz, 'yyMMdd') + '-' + Utilities.getUuid().substring(0, 6).toUpperCase();
      appendRow('Funcionarios', {
        id: newId, nome: nome.trim(), email: emailNorm,
        senha_hash: hashPassword(senha), perfil, ativo: true,
        criado_em: new Date().toISOString(),
      });
      return { success: true, message: 'Funcionário cadastrado com sucesso!', id: newId };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function toggleFuncionario(token, id) {
  try {
    requireAdmin(token);
    const found = findRow('Funcionarios', 'id', id);
    if (!found) return { success: false, error: 'Funcionário não encontrado.' };
    const novoStatus = !found.obj.ativo;
    updateRowAt('Funcionarios', found.rowIndex, { ativo: novoStatus });
    return { success: true, ativo: novoStatus, message: novoStatus ? 'Funcionário ativado.' : 'Funcionário desativado.' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function resetSenhaFuncionario(token, funcionarioId, novaSenha) {
  try {
    requireAdmin(token);
    if (!novaSenha || novaSenha.length < 6) return { success: false, error: 'Senha deve ter pelo menos 6 caracteres.' };
    const found = findRow('Funcionarios', 'id', funcionarioId);
    if (!found) return { success: false, error: 'Funcionário não encontrado.' };
    updateRowAt('Funcionarios', found.rowIndex, { senha_hash: hashPassword(novaSenha) });
    return { success: true, message: 'Senha redefinida com sucesso!' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Locais ───────────────────────────────────────────────────

function getLocais(token) {
  try {
    requireAdmin(token);
    const locais = getData('Locais');
    locais.sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt'));
    return { success: true, locais };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function salvarLocal(token, dados) {
  try {
    requireAdmin(token);
    const { id, nome, latitude, longitude, raio_metros } = dados;
    if (!nome) return { success: false, error: 'Nome do local é obrigatório.' };
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const raio = parseInt(raio_metros);
    if (isNaN(lat) || isNaN(lng)) return { success: false, error: 'Clique no mapa para definir as coordenadas.' };
    if (isNaN(raio) || raio < 10) return { success: false, error: 'Raio mínimo é 10 metros.' };
    if (raio > 10000) return { success: false, error: 'Raio máximo é 10.000 metros.' };

    if (id) {
      const found = findRow('Locais', 'id', id);
      if (!found) return { success: false, error: 'Local não encontrado.' };
      updateRowAt('Locais', found.rowIndex, { nome: nome.trim(), latitude: lat, longitude: lng, raio_metros: raio });
      return { success: true, message: 'Local atualizado com sucesso!' };
    } else {
      const tz = Session.getScriptTimeZone();
      const newId = 'L' + Utilities.formatDate(new Date(), tz, 'yyMMdd') + '-' + Utilities.getUuid().substring(0, 6).toUpperCase();
      appendRow('Locais', {
        id: newId, nome: nome.trim(), latitude: lat, longitude: lng,
        raio_metros: raio, ativo: true, criado_em: new Date().toISOString(),
      });
      return { success: true, message: 'Local cadastrado com sucesso!', id: newId };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function toggleLocal(token, id) {
  try {
    requireAdmin(token);
    const found = findRow('Locais', 'id', id);
    if (!found) return { success: false, error: 'Local não encontrado.' };
    const novoStatus = !found.obj.ativo;
    updateRowAt('Locais', found.rowIndex, { ativo: novoStatus });
    return { success: true, ativo: novoStatus };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Vínculos Funcionário ↔ Locais ────────────────────────────

function getLocaisFuncionario(token, funcionarioId) {
  try {
    requireAdmin(token);
    const vinculos = getData('FuncionarioLocais')
      .filter(v => String(v.funcionario_id) === String(funcionarioId));
    return { success: true, local_ids: vinculos.map(v => String(v.local_id)) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function setLocaisFuncionario(token, funcionarioId, locaisIds) {
  try {
    requireAdmin(token);
    const sheet = getSheet('FuncionarioLocais');
    if (sheet.getLastRow() > 1) {
      const values = sheet.getDataRange().getValues();
      const headers = values[0];
      const fidIdx = headers.indexOf('funcionario_id');
      for (let i = values.length - 1; i >= 1; i--) {
        if (String(values[i][fidIdx]) === String(funcionarioId)) sheet.deleteRow(i + 1);
      }
    }
    for (const localId of (locaisIds || [])) {
      appendRow('FuncionarioLocais', { funcionario_id: funcionarioId, local_id: localId });
    }
    return { success: true, message: 'Locais atualizados!' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Relatório ─────────────────────────────────────────────────

function getRelatorio(token, dataInicio, dataFim, funcionarioId, localId) {
  try {
    requireAdmin(token);
    let registros = getData('Registros');
    if (dataInicio) registros = registros.filter(r => String(r.timestamp) >= dataInicio);
    if (dataFim)    registros = registros.filter(r => String(r.timestamp) <= dataFim + ' 23:59:59');
    if (funcionarioId) registros = registros.filter(r => String(r.funcionario_id) === String(funcionarioId));
    if (localId)    registros = registros.filter(r => String(r.local_id) === String(localId));
    registros.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    return { success: true, registros: registros.slice(0, 500) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Configurações (via UI) ────────────────────────────────────

function getConfiguracoes(token) {
  try {
    requireAdmin(token);
    const configs = getData('Config');
    const obj = {};
    configs.forEach(c => { obj[c.chave] = c.valor; });
    return { success: true, config: obj };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function salvarConfiguracao(token, chave, valor) {
  try {
    requireAdmin(token);
    const found = findRow('Config', 'chave', chave);
    if (found) {
      updateRowAt('Config', found.rowIndex, { valor: String(valor) });
    } else {
      appendRow('Config', { chave, valor: String(valor) });
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
