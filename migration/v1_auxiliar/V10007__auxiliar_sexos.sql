-- --------------------------------------------------------

CREATE TABLE AUX_SEXOS (
                           ID NUMBER PRIMARY KEY,
                           SCAD NUMBER(1),
                           CODIGO NUMBER,
                           DESCRICAO VARCHAR2(200),
                           ORDEM NUMBER
);

CREATE SEQUENCE AUX_SEXOS_SQ
    START WITH 1
    INCREMENT BY 1
    NOMAXVALUE
    NOCACHE
    ORDER;

CREATE OR REPLACE TRIGGER AUX_SEXOS_TG
    BEFORE INSERT ON AUX_SEXOS
    FOR EACH ROW
BEGIN
    :NEW.ID := AUX_SEXOS_SQ.NEXTVAL;
END;
/

-- --------------------------------------------------------

INSERT INTO AUX_SEXOS (SCAD, CODIGO, DESCRICAO, ORDEM) VALUES (1, 0, 'Não informado', 0);
-- ----
INSERT INTO AUX_SEXOS (SCAD, CODIGO, DESCRICAO, ORDEM) VALUES (1, 1, 'Feminino', 1);
INSERT INTO AUX_SEXOS (SCAD, CODIGO, DESCRICAO, ORDEM) VALUES (1, 2, 'Masculino', 2);
INSERT INTO AUX_SEXOS (SCAD, CODIGO, DESCRICAO, ORDEM) VALUES (1, 3, 'Intersexo', 3);

-- --------------------------------------------------------
