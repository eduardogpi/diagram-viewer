-- --------------------------------------------------------

CREATE TABLE AUX_TIPO_SANGUINEO_ABO (
                           ID NUMBER PRIMARY KEY,
                           SCAD NUMBER(1),
                           CODIGO NUMBER,
                           DESCRICAO VARCHAR2(200),
                           ORDEM NUMBER
);

CREATE SEQUENCE AUX_TIPO_SANGUINEO_ABO_SQ
    START WITH 1
    INCREMENT BY 1
    NOMAXVALUE
    NOCACHE
    ORDER;

CREATE OR REPLACE TRIGGER AUX_TIPO_SANGUINEO_ABO_TG
    BEFORE INSERT ON AUX_TIPO_SANGUINEO_ABO
    FOR EACH ROW
BEGIN
    :NEW.ID := AUX_TIPO_SANGUINEO_ABO_SQ.NEXTVAL;
END;
/

-- --------------------------------------------------------

INSERT INTO AUX_TIPO_SANGUINEO_ABO (SCAD, CODIGO, DESCRICAO, ORDEM) VALUES (1, 0, 'Não informado', 0);
-- ----
INSERT INTO AUX_TIPO_SANGUINEO_ABO (SCAD, CODIGO, DESCRICAO, ORDEM) VALUES (1, 1, 'A', 1);
INSERT INTO AUX_TIPO_SANGUINEO_ABO (SCAD, CODIGO, DESCRICAO, ORDEM) VALUES (1, 2, 'B', 2);
INSERT INTO AUX_TIPO_SANGUINEO_ABO (SCAD, CODIGO, DESCRICAO, ORDEM) VALUES (1, 3, 'AB', 3);
INSERT INTO AUX_TIPO_SANGUINEO_ABO (SCAD, CODIGO, DESCRICAO, ORDEM) VALUES (1, 4, 'O', 4);

-- --------------------------------------------------------
