import neo4j from 'neo4j-driver';

// Conectar a Neo4j
const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('architect', 'architect2024')
);

const session = driver.session({
  database: 'actividadneo4j',
  defaultAccessMode: neo4j.session.WRITE
});

// Función para limpiar la base de datos (opcional)
async function cleanDatabase() {
  await session.run('MATCH (n) DETACH DELETE n');
  console.log('Base de datos limpiada');
}

// Crear investigadores (nodos)
async function createResearchers() {
  const researchers = [
    { name: 'María González', speciality: 'Inteligencia Artificial' },
    { name: 'Carlos Martínez', speciality: 'Redes Neuronales' },
    { name: 'Ana López', speciality: 'Procesamiento de Lenguaje Natural' },
    { name: 'Jorge Rodríguez', speciality: 'Visión por Computadora' },
    { name: 'Laura Sánchez', speciality: 'Inteligencia Artificial' },
    { name: 'Roberto Fernández', speciality: 'Redes Neuronales' },
    { name: 'Elena Torres', speciality: 'Procesamiento de Lenguaje Natural' },
    { name: 'Miguel Ramírez', speciality: 'Visión por Computadora' }
  ];

  const createNodesQuery = `
    UNWIND $researchers AS researcher
    CREATE (r:Researcher {name: researcher.name, speciality: researcher.speciality})
    RETURN r
  `;

  const result = await session.run(createNodesQuery, { researchers });
  console.log(`Creados ${result.records.length} investigadores`);
}

// Crear colaboraciones (relaciones) basadas en publicaciones conjuntas
async function createCollaborations() {
  const collaborations = [
    { researcher1: 'María González', researcher2: 'Carlos Martínez', papers: 5 },
    { researcher1: 'María González', researcher2: 'Ana López', papers: 3 },
    { researcher1: 'Carlos Martínez', researcher2: 'Jorge Rodríguez', papers: 2 },
    { researcher1: 'Ana López', researcher2: 'Laura Sánchez', papers: 4 },
    { researcher1: 'Laura Sánchez', researcher2: 'Roberto Fernández', papers: 6 },
    { researcher1: 'Roberto Fernández', researcher2: 'Elena Torres', papers: 3 },
    { researcher1: 'Elena Torres', researcher2: 'Miguel Ramírez', papers: 2 },
    { researcher1: 'Miguel Ramírez', researcher2: 'Jorge Rodríguez', papers: 4 },
    { researcher1: 'María González', researcher2: 'Laura Sánchez', papers: 1 }
  ];

  const createRelationshipsQuery = `
    UNWIND $collaborations AS collab
    MATCH (r1:Researcher {name: collab.researcher1})
    MATCH (r2:Researcher {name: collab.researcher2})
    CREATE (r1)-[c:COLLABORATED {papers: collab.papers}]->(r2)
    RETURN type(c) as relType, count(*) as count
  `;

  const result = await session.run(createRelationshipsQuery, { collaborations });
  console.log(`Creadas ${result.records[0].get('count').toNumber()} colaboraciones`);
}

// Crear proyección del grafo para GDS
async function createGraphProjection() {
  // Primero verificamos si necesitamos eliminar una proyección existente
  try {
    await session.run(`
      CALL gds.graph.drop('researcherGraph', false)
    `);
    console.log('Proyección anterior eliminada');
  } catch (error) {
    // La proyección no existía, continuamos
  }

  const createProjectionQuery = `
    CALL gds.graph.project(
      'researcherGraph',
      'Researcher',
      {
        COLLABORATED: {
          orientation: 'UNDIRECTED',
          properties: {
            weight: {
              property: 'papers'
            }
          }
        }
      }
    )
  `;

  const result = await session.run(createProjectionQuery);
  console.log('Proyección de grafo creada:', result.records[0].toObject());
}

// Ejecutar algoritmo de PageRank para identificar investigadores influyentes
async function runPageRank() {
  const pageRankQuery = `
    CALL gds.pageRank.stream('researcherGraph')
    YIELD nodeId, score
    RETURN gds.util.asNode(nodeId).name AS researcher, score
    ORDER BY score DESC
  `;

  const result = await session.run(pageRankQuery);
  console.log('\n--- Ranking de Investigadores Influyentes (PageRank) ---');
  result.records.forEach(record => {
    console.log(`${record.get('researcher')}: ${record.get('score').toFixed(4)}`);
  });
}

// Detectar comunidades utilizando el algoritmo de Louvain
async function detectCommunities() {
  const louvainQuery = `
    CALL gds.louvain.stream('researcherGraph')
    YIELD nodeId, communityId
    RETURN gds.util.asNode(nodeId).name AS researcher, 
           gds.util.asNode(nodeId).speciality AS speciality,
           communityId
    ORDER BY communityId, researcher
  `;

  const result = await session.run(louvainQuery);
  console.log('\n--- Comunidades de Investigadores (Louvain) ---');
  
  // Agrupar por comunidad para mostrar mejor
  const communities = {};
  result.records.forEach(record => {
    const communityId = record.get('communityId').toNumber();
    const researcher = record.get('researcher');
    const speciality = record.get('speciality');
    
    if (!communities[communityId]) {
      communities[communityId] = [];
    }
    communities[communityId].push(`${researcher} (${speciality})`);
  });
  
  // Mostrar comunidades
  Object.keys(communities).forEach(communityId => {
    console.log(`\nComunidad ${communityId}:`);
    communities[communityId].forEach(member => {
      console.log(`- ${member}`);
    });
  });
}

// Calcular similitud entre nodos (investigadores) basado en patrones de colaboración
async function calculateNodeSimilarity() {
  const similarityQuery = `
    CALL gds.nodeSimilarity.stream('researcherGraph')
    YIELD node1, node2, similarity
    RETURN 
      gds.util.asNode(node1).name AS researcher1, 
      gds.util.asNode(node2).name AS researcher2, 
      similarity
    ORDER BY similarity DESC
    LIMIT 10
  `;

  const result = await session.run(similarityQuery);
  console.log('\n--- Similitud entre Investigadores (Node Similarity) ---');
  result.records.forEach(record => {
    console.log(`${record.get('researcher1')} y ${record.get('researcher2')}: ${record.get('similarity').toFixed(4)}`);
  });
}

// Función principal para ejecutar el ejemplo completo
async function runExample() {
  try {
    await cleanDatabase();
    await createResearchers();
    await createCollaborations();
    await createGraphProjection();
    await runPageRank();
    await detectCommunities();
    await calculateNodeSimilarity();
    
    console.log('\nEjemplo completado con éxito');
  } catch (error) {
    console.error('Error al ejecutar el ejemplo:', error);
  } finally {
    await session.close();
    await driver.close();
  }
}

// Ejecutar el ejemplo
runExample();