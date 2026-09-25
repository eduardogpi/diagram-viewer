-- Renomeia o perfil visivel de instrutor para docente.
UPDATE FORTIS_PERFIS
   SET CODIGO = 'NEXO_DOCENTE',
       DESCRICAO = 'Agenda docente e registros liberados'
 WHERE CODIGO = 'NEXO_INSTRUTOR';
