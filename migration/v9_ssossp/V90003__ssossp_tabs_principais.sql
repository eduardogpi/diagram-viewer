

-- --------------------------------------------------------



CREATE TABLE SSOSSP_CONTATOS (
    ID NUMBER PRIMARY KEY,
    CORPORACAO_ID NUMBER,
    SCAD VARCHAR2(3),
    SERVIDOR_NOME VARCHAR2(250),
    SERVIDOR_CPF VARCHAR2(100),
    TELEFONE_CELULAR VARCHAR2(100),
    TELEFONE_FIXO VARCHAR2(100),
    TELEFONE_TRABALHO VARCHAR2(100),
    EMAIL VARCHAR2(250)
);

CREATE SEQUENCE SSOSSP_CONTATOS_SQ
    START WITH 1
    INCREMENT BY 1
    NOMAXVALUE
    NOCACHE
    ORDER;

CREATE OR REPLACE TRIGGER SSOSSP_CONTATOS_TG
    BEFORE INSERT ON SSOSSP_CONTATOS
    FOR EACH ROW
BEGIN
    :NEW.ID := SSOSSP_CONTATOS_SQ.NEXTVAL;
END;
/



-- --------------------------------------------------------

COMMIT;

-- --------------------------------------------------------