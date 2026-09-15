/* ============================================================================
   JETCONTROL 2026®™ — SINCRONIZAÇÃO EM NUVEM (Firebase Firestore)
   ============================================================================
   O QUE ESTE ARQUIVO FAZ:

   1) Ao abrir qualquer página do sistema, ele busca na nuvem a versão mais
      recente de cada dado (ciclos, escalas, cotas extras, valores etc.) e
      atualiza o localStorage deste navegador, se a nuvem tiver algo mais
      novo do que o que já está aqui.

   2) A partir daí, sempre que o próprio site salvar algo no localStorage
      (exatamente como já fazia antes — nenhuma função foi alterada), este
      arquivo intercepta essa gravação e também envia uma cópia para a
      nuvem, em segundo plano, sem travar a tela.

   3) Se a nuvem não estiver configurada, ou não houver internet no
      momento, o site continua funcionando 100% normalmente com os dados
      salvos localmente — exatamente como funcionava antes deste arquivo
      existir. Nada é bloqueado nem quebrado por falta de conexão.

   NÃO É NECESSÁRIO mexer em mais nada além das DUAS linhas de configuração
   logo abaixo. Todas as chaves que o sistema já usa (que começam com
   "jetcontrol_") são sincronizadas automaticamente — inclusive chaves
   novas que venham a ser criadas no futuro.
   ============================================================================ */
(function () {
  'use strict';

  // ==========================================================================
  // CONFIGURAÇÃO — PREENCHA ESTAS DUAS LINHAS E PRONTO
  // ==========================================================================
  // FIREBASE_PROJECT_ID: o "ID do projeto" que aparece nas configurações do
  //                       seu projeto Firebase (ex.: "jetcontrol-2026-abcde").
  // SYNC_SECRET:          um código só seu, inventado por você (uma senha
  //                       longa qualquer). Ele TEM que ser idêntico ao valor
  //                       colocado nas regras de segurança do Firestore
  //                       (veja o guia de configuração).
  var FIREBASE_PROJECT_ID = 'jetcontrol-2026-desmonte';
  var SYNC_SECRET          = 'jetcontrol-2026-desmonte2009';
  // ==========================================================================
  // NÃO É NECESSÁRIO ALTERAR NADA ABAIXO DESTA LINHA
  // ==========================================================================

  var PREFIXO_SINCRONIZADO = 'jetcontrol_';
  var CHAVE_META = '__jetcontrol_sync_meta__';
  var CHAVE_MARCADOR_RESET = 'sistema_reset_marker';
  var CHAVE_RESET_APLICADO = 'jetcontrol_reset_aplicado_em';
  var ATRASO_ENVIO_MS = 700;   // agrupa gravações rápidas (ex.: digitação) antes de enviar
  var TEMPO_LIMITE_MS = 4000;  // se a nuvem não responder nesse tempo, segue só com dados locais

  var configurado =
    FIREBASE_PROJECT_ID.indexOf('COLOQUE-AQUI') === -1 &&
    SYNC_SECRET.indexOf('COLOQUE-AQUI') === -1 &&
    FIREBASE_PROJECT_ID.length > 0 &&
    SYNC_SECRET.length > 0 &&
    typeof fetch === 'function';

  var URL_BASE = 'https://firestore.googleapis.com/v1/projects/' +
    encodeURIComponent(FIREBASE_PROJECT_ID) +
    '/databases/(default)/documents/jetcontrol_sync/' +
    encodeURIComponent(SYNC_SECRET) + '/dados';

  // Guarda referências originais ANTES de qualquer substituição, para que
  // o próprio motor de sincronização nunca dispare a si mesmo por engano.
  var originalSetItem = Storage.prototype.setItem;
  var originalRemoveItem = Storage.prototype.removeItem;
  var originalGetItem = Storage.prototype.getItem;

  function lerMeta() {
    try {
      return JSON.parse(originalGetItem.call(localStorage, CHAVE_META)) || {};
    } catch (e) {
      return {};
    }
  }

  function salvarMeta(meta) {
    try {
      originalSetItem.call(localStorage, CHAVE_META, JSON.stringify(meta));
    } catch (e) { /* localStorage indisponível/cheio: ignora silenciosamente */ }
  }

  function decodificarDocumento(fields) {
    var valor = (fields && fields.value && typeof fields.value.stringValue === 'string')
      ? fields.value.stringValue : null;
    var carimbo = (fields && fields.atualizadoEm && fields.atualizadoEm.integerValue)
      ? parseInt(fields.atualizadoEm.integerValue, 10) : 0;
    var apagado = !!(fields && fields.deleted && fields.deleted.booleanValue);
    return { valor: valor, atualizadoEm: carimbo, apagado: apagado };
  }

  // ------------------------- ENVIO (LOCAL → NUVEM) -------------------------
  var timersPendentes = {};

  function agendarEnvio(chave, valor, apagar) {
    if (!configurado) return;
    clearTimeout(timersPendentes[chave]);
    timersPendentes[chave] = setTimeout(function () {
      enviarAgora(chave, valor, apagar);
    }, ATRASO_ENVIO_MS);
  }

  function enviarAgora(chave, valor, apagar) {
    var agora = Date.now();
    var meta = lerMeta();
    var mascara = apagar
      ? '?updateMask.fieldPaths=deleted&updateMask.fieldPaths=atualizadoEm'
      : '?updateMask.fieldPaths=value&updateMask.fieldPaths=atualizadoEm&updateMask.fieldPaths=deleted';

    var campos = apagar
      ? { deleted: { booleanValue: true }, atualizadoEm: { integerValue: String(agora) } }
      : {
          value: { stringValue: valor },
          atualizadoEm: { integerValue: String(agora) },
          deleted: { booleanValue: false }
        };

    fetch(URL_BASE + '/' + encodeURIComponent(chave) + mascara, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: campos })
    }).catch(function () {
      // Sem internet ou nuvem fora do ar: o dado já está salvo localmente
      // (como sempre esteve) e será reenviado na próxima gravação/abertura.
    });

    meta[chave] = agora;
    salvarMeta(meta);
  }

  // Substitui setItem/removeItem para, além de continuar fazendo
  // exatamente o que já faziam, também sincronizar em segundo plano.
  Storage.prototype.setItem = function (chave, valor) {
    originalSetItem.call(this, chave, valor);
    if (this === localStorage && chave !== CHAVE_META && chave.indexOf(PREFIXO_SINCRONIZADO) === 0) {
      agendarEnvio(chave, valor, false);
    }
  };

  Storage.prototype.removeItem = function (chave) {
    originalRemoveItem.call(this, chave);
    if (this === localStorage && chave !== CHAVE_META && chave.indexOf(PREFIXO_SINCRONIZADO) === 0) {
      agendarEnvio(chave, null, true);
    }
  };

  // ------------------------- BUSCA (NUVEM → LOCAL) --------------------------
  // Retorna uma Promise que resolve com "true" se algum dado realmente
  // diferente foi aplicado ao localStorage nesta rodada (útil para saber
  // se a tela precisa ser atualizada), ou "false" se nada mudou.
  function sincronizarUmaVez() {
    if (!configurado) return Promise.resolve(false);

    var buscaComLimiteDeTempo = Promise.race([
      fetch(URL_BASE + '?pageSize=300').then(function (resposta) {
        if (!resposta.ok) throw new Error('Firestore respondeu ' + resposta.status);
        return resposta.json();
      }),
      new Promise(function (_, rejeitar) {
        setTimeout(function () { rejeitar(new Error('tempo de espera esgotado')); }, TEMPO_LIMITE_MS);
      })
    ]);

    return buscaComLimiteDeTempo.then(function (dados) {
      var documentos = (dados && dados.documents) || [];
      var meta = lerMeta();
      var chavesQueAJaEstaoNaNuvem = {};
      var houveMudancaReal = false;

      // ---------------------------------------------------------------------
      // MARCADOR DE RESET GLOBAL: se a página "resetar-dados.html" foi usada
      // em QUALQUER aparelho, ela grava um marcador com a hora do reset. Aqui
      // comparamos esse marcador com o último reset já aplicado NESTE
      // aparelho — se for mais novo, apagamos tudo localmente também, sem
      // precisar que a pessoa clique em nada neste aparelho.
      // ---------------------------------------------------------------------
      var docMarcador = documentos.filter(function (doc) {
        var partes = doc.name.split('/');
        return partes[partes.length - 1] === CHAVE_MARCADOR_RESET;
      })[0];

      if (docMarcador) {
        var infoMarcador = decodificarDocumento(docMarcador.fields);
        var ultimoResetAplicadoAqui = parseInt(originalGetItem.call(localStorage, CHAVE_RESET_APLICADO) || '0', 10);

        if (infoMarcador.atualizadoEm > ultimoResetAplicadoAqui) {
          for (var i = localStorage.length - 1; i >= 0; i--) {
            var chaveParaApagar = localStorage.key(i);
            if (chaveParaApagar && (chaveParaApagar.indexOf(PREFIXO_SINCRONIZADO) === 0 || chaveParaApagar === CHAVE_META)) {
              originalRemoveItem.call(localStorage, chaveParaApagar);
            }
          }
          originalSetItem.call(localStorage, CHAVE_RESET_APLICADO, String(infoMarcador.atualizadoEm));
          // Reset aplicado: não há mais nada local para comparar/enviar
          // nesta rodada, então encerramos por aqui.
          return true;
        }
      }

      documentos.forEach(function (doc) {
        var partesDoNome = doc.name.split('/');
        var chave = partesDoNome[partesDoNome.length - 1];
        if (chave === CHAVE_MARCADOR_RESET) return;
        chavesQueAJaEstaoNaNuvem[chave] = true;

        var info = decodificarDocumento(doc.fields);
        var carimboLocal = meta[chave] || 0;
        var valorAntesDaAtualizacao = originalGetItem.call(localStorage, chave);

        if (info.apagado) {
          if (valorAntesDaAtualizacao !== null) {
            originalRemoveItem.call(localStorage, chave);
            houveMudancaReal = true;
          }
          meta[chave] = info.atualizadoEm;
          return;
        }

        if (info.valor !== null && info.atualizadoEm >= carimboLocal) {
          if (info.valor !== valorAntesDaAtualizacao) {
            originalSetItem.call(localStorage, chave, info.valor);
            houveMudancaReal = true;
          }
          meta[chave] = info.atualizadoEm;
        }
      });

      // Qualquer dado local que a nuvem ainda não conhece é enviado agora,
      // "semeando" a nuvem (útil na primeira vez que a sincronização roda).
      for (var i = 0; i < localStorage.length; i++) {
        var chaveLocal = localStorage.key(i);
        if (chaveLocal && chaveLocal !== CHAVE_META &&
            chaveLocal.indexOf(PREFIXO_SINCRONIZADO) === 0 &&
            !chavesQueAJaEstaoNaNuvem[chaveLocal]) {
          var valorLocal = originalGetItem.call(localStorage, chaveLocal);
          if (valorLocal !== null) agendarEnvio(chaveLocal, valorLocal, false);
        }
      }

      salvarMeta(meta);
      return houveMudancaReal;
    }).catch(function (erro) {
      console.warn(
        '[JETCONTROL SYNC] Não foi possível buscar dados da nuvem agora (seguindo com dados locais). Detalhe:',
        erro && erro.message
      );
      return false;
    });
  }

  // Promise pública. Cada página aguarda por ela (com segurança, mesmo se
  // falhar) antes de ler o localStorage, garantindo que dados vindos de
  // outro aparelho já estejam disponíveis assim que a tela é montada.
  window.JetSyncReady = sincronizarUmaVez();

  window.JetSyncStatus = function () {
    return configurado
      ? 'Sincronização em nuvem ATIVA (projeto: ' + FIREBASE_PROJECT_ID + ')'
      : 'Sincronização em nuvem NÃO CONFIGURADA (edite jetcontrol-sync.js)';
  };

  // ------------------- ATUALIZAÇÃO EM TEMPO REAL (POLLING) -------------------
  // Cada página pode se inscrever para ser avisada quando dados vindos de
  // OUTRO navegador/aparelho chegarem, e então atualizar só a exibição na
  // tela (sem precisar apertar F5 e sem mexer no que o usuário estiver
  // digitando no momento).
  var INTERVALO_VERIFICACAO_MS = 4000;
  var ouvintes = [];
  var cicloAgendado = null;
  var verificandoAgora = false;

  window.JetSyncOnChange = function (funcaoOuvinte) {
    if (typeof funcaoOuvinte === 'function') ouvintes.push(funcaoOuvinte);
  };

  function avisarOuvintes() {
    ouvintes.forEach(function (fn) {
      try { fn(); } catch (e) { console.error('[JETCONTROL SYNC] Erro ao atualizar a tela:', e); }
    });
  }

  function cicloDeVerificacao() {
    if (document.visibilityState !== 'visible') {
      agendarProximoCiclo();
      return;
    }
    verificandoAgora = true;
    sincronizarUmaVez().then(function (houveMudanca) {
      verificandoAgora = false;
      if (houveMudanca) avisarOuvintes();
      agendarProximoCiclo();
    });
  }

  function agendarProximoCiclo() {
    clearTimeout(cicloAgendado);
    cicloAgendado = setTimeout(cicloDeVerificacao, INTERVALO_VERIFICACAO_MS);
  }

  if (configurado) {
    agendarProximoCiclo();

    // Ao voltar para a aba (trocar de janela/aplicativo e retornar),
    // verifica na hora em vez de esperar o próximo ciclo.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && !verificandoAgora) {
        clearTimeout(cicloAgendado);
        cicloDeVerificacao();
      }
    });
  }
})();
