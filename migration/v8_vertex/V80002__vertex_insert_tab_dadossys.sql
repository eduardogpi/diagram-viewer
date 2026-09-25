-- --------------------------------------------------------

INSERT INTO VERTEX_DADOSSYS (ID,
                   VERSAO_COD,
                   SISTEMA_VERSAO,
                   SISTEMA_NOME,
                   SISTEMA_DESCRICAO,
                   SISTEMA_FINALIDADE,
                   DIR_MIN,
                   DIR_NM,
                   DIR_PC,
                   DIR_MAI,
                   PERFIL_SSO) VALUES (1,
                                       '1',
                                       '1.0',
                                       'VERTEX-AV',
                                       'Sistema de Geração, Consolidação, Versionamento e Expedição de Avaliações, Provas e Listagens',
                                       'Geração automatizada de questões a partir de materiais de referência, importação de itens previamente elaborados, montagem paramétrica de avaliações por módulo temático, transformação em quatro tipos de prova com reordenação de questões e alternativas, geração de provas em PDF e emissão de listas de frequência.',
                                       'vertex',
                                       'Vertex',
                                       'Vertex',
                                       'VERTEX',
                                       'legado'
                                      );

-- --------------------------------------------------------