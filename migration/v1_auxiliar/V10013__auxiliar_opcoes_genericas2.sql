-- --------------------------------------------------------

CREATE TABLE AUX_OPCOES_GENERICAS2 (
                           ID NUMBER PRIMARY KEY,
                           SCAD NUMBER(1),
                           CODIGO NUMBER,
                           DESCRICAO VARCHAR2(200),
                           ORDEM NUMBER
);

CREATE SEQUENCE AUX_OPCOES_GENERICAS2_SQ
    START WITH 1
    INCREMENT BY 1
    NOMAXVALUE
    NOCACHE
    ORDER;

CREATE OR REPLACE TRIGGER AUX_OPCOES_GENERICAS2_TG
    BEFORE INSERT ON AUX_OPCOES_GENERICAS2
    FOR EACH ROW
BEGIN
    :NEW.ID := AUX_OPCOES_GENERICAS2_SQ.NEXTVAL;
END;
/

-- --------------------------------------------------------

INSERT INTO AUX_OPCOES_GENERICAS2 (SCAD, CODIGO, DESCRICAO, ORDEM) VALUES (1, 0, 'Não informado', 0);
-- ----
INSERT INTO AUX_OPCOES_GENERICAS2 (SCAD, CODIGO, DESCRICAO, ORDEM) VALUES (1, 1, 'Não se aplica', 1);
INSERT INTO AUX_OPCOES_GENERICAS2 (SCAD, CODIGO, DESCRICAO, ORDEM) VALUES (1, 2, 'Sim', 2);
INSERT INTO AUX_OPCOES_GENERICAS2 (SCAD, CODIGO, DESCRICAO, ORDEM) VALUES (1, 3, 'Não', 3);

-- --------------------------------------------------------
