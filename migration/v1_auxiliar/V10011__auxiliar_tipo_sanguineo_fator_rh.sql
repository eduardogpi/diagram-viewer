-- --------------------------------------------------------

CREATE TABLE AUX_TIPO_SANGUINEO_FATOR_RH (
                           ID NUMBER PRIMARY KEY,
                           SCAD NUMBER(1),
                           CODIGO NUMBER,
                           DESCRICAO VARCHAR2(200),
                           ORDEM NUMBER
);

CREATE SEQUENCE AUX_TIPO_SANGUINEO_FATOR_RH_SQ
    START WITH 1
    INCREMENT BY 1
    NOMAXVALUE
    NOCACHE
    ORDER;

CREATE OR REPLACE TRIGGER AUX_TIPO_SANGUINEO_FATOR_RH_TG
    BEFORE INSERT ON AUX_TIPO_SANGUINEO_FATOR_RH
    FOR EACH ROW
BEGIN
    :NEW.ID := AUX_TIPO_SANGUINEO_FATOR_RH_SQ.NEXTVAL;
END;
/

-- --------------------------------------------------------

INSERT INTO AUX_TIPO_SANGUINEO_FATOR_RH (SCAD, CODIGO, DESCRICAO, ORDEM) VALUES (1, 0, 'Não informado', 0);
-- ----
INSERT INTO AUX_TIPO_SANGUINEO_FATOR_RH (SCAD, CODIGO, DESCRICAO, ORDEM) VALUES (1, 1, '-', 1);
INSERT INTO AUX_TIPO_SANGUINEO_FATOR_RH (SCAD, CODIGO, DESCRICAO, ORDEM) VALUES (1, 2, '+', 2);

-- --------------------------------------------------------
