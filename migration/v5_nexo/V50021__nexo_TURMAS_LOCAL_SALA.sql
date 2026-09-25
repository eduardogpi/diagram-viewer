ALTER TABLE NEXO_TURMAS ADD LOCAL_SALA VARCHAR2(160);

COMMENT ON COLUMN NEXO_TURMAS.LOCAL_SALA IS 'Sala, ambiente ou local padrao de realizacao das aulas da turma.';
