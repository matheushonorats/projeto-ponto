// ===================================================
// Registros.gs — Attendance Registration & History
// ===================================================

const TIPOS = ['entrada', 'pausa', 'retorno', 'saída'];

const TIPO_LABELS = { entrada: 'Entrada', pausa: 'Pausa', retorno: 'Retorno', 'saída': 'Saída' };

function getProximosTipos(ultimoTipo) {
  switch (String(ultimoTipo || '').toLowerCase()) {
    case 'entrada':  return ['pausa', 'saída'];
    case 'pausa':    return ['retorno'];
    case 'retorno':  return ['pausa', 'saída'];
    case 'saída':    return ['entrada'];
    default:         return ['entrada'];
  }
}

function getLocaisDoFuncionario(funcionarioId) {
  const vinculos = getData('FuncionarioLocais')
    .filter(v => String(v.funcionario_id) === String(funcionarioId));
  const ids = new Set(vinculos.map(v => String(v.local_id)));
  return getData('Locais').filter(l => ids.has(String(l.id)) && l.ativo === true);
}

function getRegistrosHoje(funcionarioId) {
  const tz = Session.getScriptTimeZone();
  const hoje = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  return getData('Registros').filter(r =>
    String(r.funcionario_id) === String(funcionarioId) &&
    String(r.timestamp).startsWith(hoje)
  );
}

// ── Status: GPS check + today's state ────────────────────────

function getStatusFuncionario(token, latitude, longitude) {
  try {
    const user = getSessionUser(token);
    if (!user) return { success: false, error: 'Sessão inválida.' };

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    const locaisAutorizados = getLocaisDoFuncionario(user.id);
    if (locaisAutorizados.length === 0) {
      return {
        success: true,
        dentroDeArea: false,
        locais: [],
        ultimoTipo: null,
        proximosTipos: [],
        registrosHoje: [],
        erro: 'Nenhum local de trabalho configurado. Contate o administrador.',
      };
    }

    const locaisComDistancia = locaisAutorizados.map(l => {
      const distancia = Math.round(haversineDistance(lat, lng, parseFloat(l.latitude), parseFloat(l.longitude)));
      return {
        id: l.id,
        nome: l.nome,
        raio: parseInt(l.raio_metros),
        distancia,
        dentro: distancia <= parseInt(l.raio_metros),
      };
    });

    const dentroDeArea = locaisComDistancia.some(l => l.dentro);
    const localAtivo = locaisComDistancia.filter(l => l.dentro).sort((a, b) => a.distancia - b.distancia)[0] || null;

    const registrosHoje = getRegistrosHoje(user.id);
    const ultimoTipo = registrosHoje.length > 0 ? registrosHoje[registrosHoje.length - 1].tipo : null;

    return {
      success: true,
      dentroDeArea,
      localAtivo,
      locais: locaisComDistancia,
      ultimoTipo,
      proximosTipos: getProximosTipos(ultimoTipo),
      registrosHoje: registrosHoje.map(r => ({
        tipo: r.tipo,
        local_nome: r.local_nome,
        timestamp: r.timestamp,
      })),
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Register punch ────────────────────────────────────────────

function registrarPonto(token, tipo, latitude, longitude, userAgent) {
  try {
    const user = getSessionUser(token);
    if (!user) return { success: false, error: 'Sessão inválida. Faça login novamente.' };

    tipo = String(tipo).toLowerCase();
    if (!TIPOS.includes(tipo)) return { success: false, error: 'Tipo de registro inválido.' };

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng)) return { success: false, error: 'Coordenadas GPS inválidas.' };

    // Find nearest authorized location within radius
    const locaisAutorizados = getLocaisDoFuncionario(user.id);
    if (locaisAutorizados.length === 0) {
      return { success: false, error: 'Nenhum local autorizado configurado. Contate o administrador.' };
    }

    let localEncontrado = null;
    let menorDist = Infinity;
    for (const local of locaisAutorizados) {
      const dist = haversineDistance(lat, lng, parseFloat(local.latitude), parseFloat(local.longitude));
      if (dist <= parseFloat(local.raio_metros) && dist < menorDist) {
        menorDist = dist;
        localEncontrado = local;
      }
    }

    if (!localEncontrado) {
      return { success: false, error: 'Você está fora da área de trabalho autorizada.' };
    }

    // Validate sequence
    const registrosHoje = getRegistrosHoje(user.id);
    const ultimoTipo = registrosHoje.length > 0 ? registrosHoje[registrosHoje.length - 1].tipo : null;
    const tiposPermitidos = getProximosTipos(ultimoTipo);

    if (!tiposPermitidos.includes(tipo)) {
      const esperados = tiposPermitidos.map(t => TIPO_LABELS[t]).join(' ou ');
      return { success: false, error: `Ação inválida. Esperado: ${esperados}.` };
    }

    // Save
    const tz = Session.getScriptTimeZone();
    const id = 'R' + Utilities.formatDate(new Date(), tz, 'yyyyMMddHHmmss') + '-' + Utilities.getUuid().substring(0, 4).toUpperCase();
    const timestamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');

    appendRow('Registros', {
      id,
      funcionario_id: user.id,
      nome: user.nome,
      local_id: localEncontrado.id,
      local_nome: localEncontrado.nome,
      tipo,
      latitude: lat,
      longitude: lng,
      timestamp,
      dispositivo: (userAgent || '').substring(0, 150),
    });

    return {
      success: true,
      message: `${TIPO_LABELS[tipo]} registrada!`,
      local: localEncontrado.nome,
      hora: timestamp.split(' ')[1],
      proximosTipos: getProximosTipos(tipo),
    };
  } catch (e) {
    Logger.log('registrarPonto error: ' + e.stack);
    return { success: false, error: 'Erro ao registrar: ' + e.message };
  }
}

// ── Employee history ──────────────────────────────────────────

function getMeusPontos(token, dataInicio, dataFim) {
  try {
    const user = getSessionUser(token);
    if (!user) return { success: false, error: 'Sessão inválida.' };

    let registros = getData('Registros').filter(r => String(r.funcionario_id) === String(user.id));
    if (dataInicio) registros = registros.filter(r => String(r.timestamp) >= dataInicio);
    if (dataFim)    registros = registros.filter(r => String(r.timestamp) <= dataFim + ' 23:59:59');

    registros.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    return { success: true, registros: registros.slice(0, 200) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
