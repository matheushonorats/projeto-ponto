// ===================================================
// Registros.gs — Punch registration and history
// ===================================================

const TIPOS = Object.freeze(['entrada', 'pausa', 'retorno', 'saída']);
const TIPO_LABELS = Object.freeze({ entrada: 'Entrada', pausa: 'Pausa', retorno: 'Retorno', 'saída': 'Saída' });
const MAX_GPS_ACCURACY_METERS = 200;

function getProximosTipos(ultimoTipo) {
  const transitions = {
    entrada: ['pausa', 'saída'],
    pausa: ['retorno'],
    retorno: ['pausa', 'saída'],
    'saída': ['entrada'],
  };
  return transitions[String(ultimoTipo || '').toLowerCase()] || ['entrada'];
}

function getLocaisDoFuncionario(funcionarioId) {
  const linkedIds = new Set(getData('FuncionarioLocais')
    .filter(link => String(link.funcionario_id) === String(funcionarioId))
    .map(link => String(link.local_id)));
  return getData('Locais').filter(location => linkedIds.has(String(location.id)) && isActive(location.ativo));
}

function getRegistrosHoje(funcionarioId) {
  return getData('Registros')
    .filter(record => String(record.funcionario_id) === String(funcionarioId)
      && String(record.timestamp).startsWith(todayPrefix()))
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
}

function filterRecords(records, startDate, endDate) {
  let result = records;
  if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(String(startDate))) {
    result = result.filter(record => String(record.timestamp) >= `${startDate} 00:00:00`);
  }
  if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(String(endDate))) {
    result = result.filter(record => String(record.timestamp) <= `${endDate} 23:59:59`);
  }
  return result;
}

function locateEmployee(latitude, longitude, employeeId) {
  let nearest = null;
  getLocaisDoFuncionario(employeeId).forEach(location => {
    const locationLat = parseCoordinate(location.latitude, -90, 90);
    const locationLng = parseCoordinate(location.longitude, -180, 180);
    const radius = Number(location.raio_metros);
    if (locationLat === null || locationLng === null || !Number.isFinite(radius)) return;
    const distance = haversineDistance(latitude, longitude, locationLat, locationLng);
    const candidate = {
      id: location.id,
      nome: location.nome,
      raio: Math.round(radius),
      distancia: Math.round(distance),
      dentro: distance <= radius,
      source: location,
    };
    if (!nearest || candidate.distancia < nearest.distancia) nearest = candidate;
  });
  return nearest;
}

function getStatusFuncionario(token, latitude, longitude) {
  try {
    const user = getSessionUser(token);
    if (!user) return { success: false, error: 'Sessão inválida.' };
    const lat = parseCoordinate(latitude, -90, 90);
    const lng = parseCoordinate(longitude, -180, 180);
    if (lat === null || lng === null) return { success: false, error: 'Localização inválida.' };

    const locations = getLocaisDoFuncionario(user.id).map(location => {
      const locationLat = parseCoordinate(location.latitude, -90, 90);
      const locationLng = parseCoordinate(location.longitude, -180, 180);
      const radius = Number(location.raio_metros);
      const distance = locationLat === null || locationLng === null ? Infinity : haversineDistance(lat, lng, locationLat, locationLng);
      return { id: location.id, nome: location.nome, raio: Math.round(radius), distancia: Math.round(distance), dentro: distance <= radius };
    }).filter(location => Number.isFinite(location.distancia));

    if (locations.length === 0) {
      return { success: true, dentroDeArea: false, locais: [], ultimoTipo: null, proximosTipos: [], registrosHoje: [], erro: 'Nenhum local de trabalho configurado.' };
    }

    const records = getRegistrosHoje(user.id);
    const lastType = records.length ? records[records.length - 1].tipo : null;
    const activeLocation = locations.filter(location => location.dentro).sort((a, b) => a.distancia - b.distancia)[0] || null;
    return {
      success: true,
      dentroDeArea: Boolean(activeLocation),
      localAtivo: activeLocation,
      locais: locations,
      ultimoTipo: lastType,
      proximosTipos: getProximosTipos(lastType),
      registrosHoje: records.map(record => ({ tipo: record.tipo, local_nome: record.local_nome, timestamp: record.timestamp })),
    };
  } catch (error) {
    return { success: false, error: 'Não foi possível verificar sua localização.' };
  }
}

function registrarPonto(token, tipo, latitude, longitude, userAgent, accuracy) {
  try {
    const normalizedType = String(tipo || '').toLowerCase();
    if (!TIPOS.includes(normalizedType)) return { success: false, error: 'Tipo de registro inválido.' };
    const lat = parseCoordinate(latitude, -90, 90);
    const lng = parseCoordinate(longitude, -180, 180);
    const gpsAccuracy = Number(accuracy);
    if (lat === null || lng === null) return { success: false, error: 'Coordenadas GPS inválidas.' };
    if (Number.isFinite(gpsAccuracy) && gpsAccuracy > MAX_GPS_ACCURACY_METERS) {
      return { success: false, error: 'A precisão do GPS está baixa. Aguarde uma leitura melhor e tente novamente.' };
    }

    return withScriptLock(() => {
      const user = getSessionUser(token);
      if (!user) return { success: false, error: 'Sessão inválida. Entre novamente.' };
      const nearest = locateEmployee(lat, lng, user.id);
      if (!nearest) return { success: false, error: 'Nenhum local autorizado configurado.' };
      if (!nearest.dentro) return { success: false, error: 'Você está fora da área de trabalho autorizada.' };

      const records = getRegistrosHoje(user.id);
      const lastType = records.length ? records[records.length - 1].tipo : null;
      const allowedTypes = getProximosTipos(lastType);
      if (!allowedTypes.includes(normalizedType)) {
        return { success: false, error: `Ação inválida. Próximo registro: ${allowedTypes.map(item => TIPO_LABELS[item]).join(' ou ')}.` };
      }

      const now = new Date();
      const timestamp = formatTimestamp(now);
      appendRow('Registros', {
        id: `R${Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMddHHmmss')}-${Utilities.getUuid().slice(0, 8).toUpperCase()}`,
        funcionario_id: user.id,
        nome: String(user.nome).slice(0, 120),
        local_id: nearest.id,
        local_nome: String(nearest.nome).slice(0, 120),
        tipo: normalizedType,
        latitude: lat,
        longitude: lng,
        timestamp,
        dispositivo: String(userAgent || '').replace(/[\r\n\t]/g, ' ').slice(0, 200),
      });

      return {
        success: true,
        message: `${TIPO_LABELS[normalizedType]} registrada.`,
        local: nearest.nome,
        hora: timestamp.slice(11),
        proximosTipos: getProximosTipos(normalizedType),
      };
    });
  } catch (error) {
    console.error('registrarPonto', error);
    return { success: false, error: 'Não foi possível registrar o ponto.' };
  }
}

function getMeusPontos(token, dataInicio, dataFim) {
  try {
    const user = getSessionUser(token);
    if (!user) return { success: false, error: 'Sessão inválida.' };
    const records = filterRecords(getData('Registros'), dataInicio, dataFim)
      .filter(record => String(record.funcionario_id) === String(user.id))
      .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    return { success: true, registros: records.slice(0, 200) };
  } catch (error) {
    return { success: false, error: 'Não foi possível carregar o histórico.' };
  }
}
