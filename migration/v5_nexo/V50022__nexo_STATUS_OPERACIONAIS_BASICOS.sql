-- Cadastros basicos ja entram em operacao ao serem criados.
-- RASCUNHO permanece reservado para fluxos com revisao/publicacao, como QTS.
UPDATE NEXO_CONVOCACOES
   SET STATUS = 'ATIVA'
 WHERE STATUS = 'RASCUNHO';

UPDATE NEXO_TURMAS
   SET STATUS = 'ATIVA'
 WHERE STATUS = 'RASCUNHO';
