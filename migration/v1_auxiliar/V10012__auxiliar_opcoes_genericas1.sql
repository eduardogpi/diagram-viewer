-- --------------------------------------------------------

CREATE TABLE AUX_OPCOES_GENERICAS1 (
                           ID NUMBER PRIMARY KEY,
                           SCAD NUMBER(1),
                           CODIGO NUMBER,
                           DESCRICAO VARCHAR2(200),
                           ORDEM NUMBER
);

CREATE SEQUENCE AUX_OPCOES_GENERICAS1_SQ
    START WITH 1
    INCREMENT BY 1
    NOMAXVALUE
    NOCACHE
    ORDER;

CREATE OR REPLACE TRIGGER AUX_OPCOES_GENERICAS1_TG
    BEFORE INSERT ON AUX_OPCOES_GENERICAS1
    FOR EACH ROW
BEGIN
    :NEW.ID := AUX_OPCOES_GENERICAS1_SQ.NEXTVAL;
END;
/

-- --------------------------------------------------------

INSERT INTO AUX_OPCOES_GENERICAS1 (SCAD, CODIGO, DESCRICAO, ORDEM) VALUES (1, 0, 'Não informado', 0);
-- ----
INSERT INTO AUX_OPCOES_GENERICAS1 (SCAD, CODIGO, DESCRICAO, ORDEM) VALUES (1, 1, 'Sim', 1);
INSERT INTO AUX_OPCOES_GENERICAS1 (SCAD, CODIGO, DESCRICAO, ORDEM) VALUES (1, 2, 'Não', 2);

-- --------------------------------------------------------
