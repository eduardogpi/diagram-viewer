-- Corrige os modulos D3/D4 considerando os IDs reais dos eixos ja existentes.
-- A migracao anterior ajustou os textos das disciplinas/eixos, mas alguns modulos
-- foram atualizados por IDs assumidos. Aqui mantemos os vinculos fisicos e alinhamos
-- codigo, nome e carga conforme a planilha operacional da ESPP.

UPDATE NEXO_MODULOS_TEMATICOS
SET CODIGO = 'D3.ET1.M1',
    NOME = 'Qualidade de vida no trabalho e prevencao do adoecimento ocupacional',
    CARGA_HORARIA = 8,
    ORDEM = 1,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1030012;

UPDATE NEXO_MODULOS_TEMATICOS
SET CODIGO = 'D3.ET2.M1',
    NOME = 'Etica aplicada, postura profissional e tomada de decisao na custodia',
    CARGA_HORARIA = 20,
    ORDEM = 1,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1030013;

UPDATE NEXO_MODULOS_TEMATICOS
SET CODIGO = 'D3.ET3.M1',
    NOME = 'Regime disciplinar, transgressoes e consequencias na carreira',
    CARGA_HORARIA = 12,
    ORDEM = 1,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1030014;

UPDATE NEXO_MODULOS_TEMATICOS
SET CODIGO = 'D3.ET4.M1',
    NOME = 'Atuacao da Policia Penal e Crimes contra a Administracao Publica: Limites Legais, Responsabilidade e Controle',
    CARGA_HORARIA = 10,
    ORDEM = 1,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1030015;

UPDATE NEXO_MODULOS_TEMATICOS
SET CODIGO = 'D3.ET4.M2',
    NOME = 'Abuso de Autoridade e Tortura no Contexto Prisional: Prevencao, Controle e Responsabilizacao Funcional',
    CARGA_HORARIA = 10,
    ORDEM = 2,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1030016;

UPDATE NEXO_MODULOS_TEMATICOS
SET CODIGO = 'D4.ET1.M1',
    NOME = 'Procedimentos de seguranca prisional, controle e resposta a incidentes',
    CARGA_HORARIA = 20,
    ORDEM = 1,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1030017;

UPDATE NEXO_MODULOS_TEMATICOS
SET CODIGO = 'D4.ET2.M1',
    NOME = 'Planejamento e execucao de escoltas, transferencias e recambiamentos',
    CARGA_HORARIA = 16,
    ORDEM = 1,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1030018;

UPDATE NEXO_MODULOS_TEMATICOS
SET CODIGO = 'D4.ET3.M1',
    NOME = 'Fundamentos de armamento, tiro e seguranca no manuseio',
    CARGA_HORARIA = 12,
    ORDEM = 1,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1030019;

UPDATE NEXO_MODULOS_TEMATICOS
SET CODIGO = 'D4.ET4.M1',
    NOME = 'Atendimento pre-hospitalar tatico para atividades de Policia Penal',
    CARGA_HORARIA = 8,
    ORDEM = 1,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1030020;

UPDATE NEXO_MODULOS_TEMATICOS
SET CODIGO = 'D4.ET5.M1',
    NOME = 'Tecnologias menos letais e criterios de emprego em ambiente prisional',
    CARGA_HORARIA = 6,
    ORDEM = 1,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1030021;

UPDATE NEXO_MODULOS_TEMATICOS
SET CODIGO = 'D4.ET5.M2',
    NOME = 'Intervencao Taticas no contexto de atuacao da Policia Penal de Goias',
    CARGA_HORARIA = 18,
    ORDEM = 2,
    ATUALIZADO_EM = CURRENT_TIMESTAMP
WHERE ID = 1030022;
