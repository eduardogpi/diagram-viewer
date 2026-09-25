-- Ajusta a matriz CFPPGO 2026 para a codificacao operacional usada pela ESPP.
-- A correcao preserva IDs para nao quebrar habilitacoes, aulas, QTS e relatorios.

UPDATE NEXO_DISCIPLINAS
SET NOME = 'Servidor Penitenciario',
    DESCRICAO = 'D3 - 54h presenciais + 6h assincronas = 60h.',
    ORDEM = 3,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1010004
  AND MATRIZ_ID = 1012026;

UPDATE NEXO_EIXOS_TEMATICOS
SET NOME = 'Saude e desempenho profissional do Policial Penal',
    DESCRICAO = 'D3.ET1 - carga horaria do eixo: 8h.',
    ORDEM = 1,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1020014;

UPDATE NEXO_MODULOS_TEMATICOS
SET CODIGO = 'D3.ET1.M1',
    NOME = 'Qualidade de vida no trabalho e prevencao do adoecimento ocupacional',
    CARGA_HORARIA = 8,
    ORDEM = 1,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1030018;

UPDATE NEXO_EIXOS_TEMATICOS
SET NOME = 'Etica e conduta profissional na Policia Penal',
    DESCRICAO = 'D3.ET2 - carga horaria do eixo: 20h.',
    ORDEM = 2,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1020015;

UPDATE NEXO_MODULOS_TEMATICOS
SET CODIGO = 'D3.ET2.M1',
    NOME = 'Etica aplicada, postura profissional e tomada de decisao na custodia',
    CARGA_HORARIA = 20,
    ORDEM = 1,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1030019;

UPDATE NEXO_EIXOS_TEMATICOS
SET NOME = 'Disciplina funcional e responsabilizacao administrativa',
    DESCRICAO = 'D3.ET3 - carga horaria do eixo: 12h.',
    ORDEM = 3,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1020016;

UPDATE NEXO_MODULOS_TEMATICOS
SET CODIGO = 'D3.ET3.M1',
    NOME = 'Regime disciplinar, transgressoes e consequencias na carreira',
    CARGA_HORARIA = 12,
    ORDEM = 1,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1030020;

UPDATE NEXO_EIXOS_TEMATICOS
SET NOME = 'Responsabilidade penal e limites legais na atuacao funcional',
    DESCRICAO = 'D3.ET4 - carga horaria do eixo: 20h.',
    ORDEM = 4,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1020017;

UPDATE NEXO_MODULOS_TEMATICOS
SET CODIGO = 'D3.ET4.M1',
    NOME = 'Atuacao da Policia Penal e Crimes contra a Administracao Publica: Limites Legais, Responsabilidade e Controle',
    CARGA_HORARIA = 10,
    ORDEM = 1,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1030021;

UPDATE NEXO_MODULOS_TEMATICOS
SET CODIGO = 'D3.ET4.M2',
    NOME = 'Abuso de Autoridade e Tortura no Contexto Prisional: Prevencao, Controle e Responsabilizacao Funcional',
    CARGA_HORARIA = 10,
    ORDEM = 2,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1030022;

UPDATE NEXO_DISCIPLINAS
SET NOME = 'Seguranca e Disciplina',
    DESCRICAO = 'D4 - 80h presenciais + 0h assincronas = 80h.',
    ORDEM = 4,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1010003
  AND MATRIZ_ID = 1012026;

UPDATE NEXO_EIXOS_TEMATICOS
SET NOME = 'Seguranca prisional e resposta a incidentes',
    DESCRICAO = 'D4.ET1 - carga horaria do eixo: 20h.',
    ORDEM = 1,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1020009;

UPDATE NEXO_MODULOS_TEMATICOS
SET CODIGO = 'D4.ET1.M1',
    NOME = 'Procedimentos de seguranca prisional, controle e resposta a incidentes',
    CARGA_HORARIA = 20,
    ORDEM = 1,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1030012;

UPDATE NEXO_EIXOS_TEMATICOS
SET NOME = 'Escoltas, transferencias e recambiamentos',
    DESCRICAO = 'D4.ET2 - carga horaria do eixo: 16h.',
    ORDEM = 2,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1020010;

UPDATE NEXO_MODULOS_TEMATICOS
SET CODIGO = 'D4.ET2.M1',
    NOME = 'Planejamento e execucao de escoltas, transferencias e recambiamentos',
    CARGA_HORARIA = 16,
    ORDEM = 1,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1030013;

UPDATE NEXO_EIXOS_TEMATICOS
SET NOME = 'Armamento, tiro e seguranca no manuseio',
    DESCRICAO = 'D4.ET3 - carga horaria do eixo: 12h.',
    ORDEM = 3,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1020011;

UPDATE NEXO_MODULOS_TEMATICOS
SET CODIGO = 'D4.ET3.M1',
    NOME = 'Fundamentos de armamento, tiro e seguranca no manuseio',
    CARGA_HORARIA = 12,
    ORDEM = 1,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1030014;

UPDATE NEXO_EIXOS_TEMATICOS
SET NOME = 'Atendimento pre-hospitalar tatico',
    DESCRICAO = 'D4.ET4 - carga horaria do eixo: 8h.',
    ORDEM = 4,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1020012;

UPDATE NEXO_MODULOS_TEMATICOS
SET CODIGO = 'D4.ET4.M1',
    NOME = 'Atendimento pre-hospitalar tatico para atividades de Policia Penal',
    CARGA_HORARIA = 8,
    ORDEM = 1,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1030015;

UPDATE NEXO_EIXOS_TEMATICOS
SET NOME = 'Tecnologias menos letais e intervencao tatica prisional',
    DESCRICAO = 'D4.ET5 - carga horaria do eixo: 24h.',
    ORDEM = 5,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1020013;

UPDATE NEXO_MODULOS_TEMATICOS
SET CODIGO = 'D4.ET5.M1',
    NOME = 'Tecnologias menos letais e criterios de emprego em ambiente prisional',
    CARGA_HORARIA = 6,
    ORDEM = 1,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1030016;

UPDATE NEXO_MODULOS_TEMATICOS
SET CODIGO = 'D4.ET5.M2',
    NOME = 'Intervencao Taticas no contexto de atuacao da Policia Penal de Goias',
    CARGA_HORARIA = 18,
    ORDEM = 2,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1030017;
