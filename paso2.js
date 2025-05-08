// Red Bibliográfica con Neo4j y APOC
// Este script demuestra cómo crear una red bibliográfica utilizando:
// 1. Importación de datos desde una API externa usando apoc.load.json
// 2. Creación de nodos y relaciones con apoc.create
// 3. Análisis de rutas con apoc.path.expand
// 4. Generación de citas

import neo4j from 'neo4j-driver';

// Conexión a Neo4j
const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('architect', 'architect2024')
);

const session = driver.session({
  database: 'test',
  defaultAccessMode: neo4j.session.WRITE
});

// Limpiar la base de datos antes de comenzar
const clearDatabase = async () => {
  try {
    await session.run('MATCH (n) DETACH DELETE n');
    console.log('Base de datos limpiada con éxito');
  } catch (error) {
    console.error('Error al limpiar la base de datos:', error);
  }
};

// 1. Crear esquema (índices y constraints)
const setupSchema = async () => {
  try {
    // Constraints para asegurar unicidad
    await session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (a:Author) REQUIRE a.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (p:Paper) REQUIRE p.doi IS UNIQUE');
    await session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (j:Journal) REQUIRE j.name IS UNIQUE');
    
    // Índices para mejorar rendimiento
    await session.run('CREATE INDEX IF NOT EXISTS FOR (a:Author) ON (a.name)');
    await session.run('CREATE INDEX IF NOT EXISTS FOR (p:Paper) ON (p.title)');
    await session.run('CREATE INDEX IF NOT EXISTS FOR (k:Keyword) ON (k.term)');
    
    console.log('Esquema configurado correctamente');
  } catch (error) {
    console.error('Error al configurar el esquema:', error);
  }
};

// 2. Importar datos de artículos científicos desde una API externa usando APOC
const importPapersFromAPI = async () => {
  try {
    // Usando apoc.load.json para obtener datos de una API externa
    // En este caso importamos artículos sobre inteligencia artificial
    const result = await session.run(`
      CALL apoc.load.json('https://api.crossref.org/works?query=artificial+intelligence&rows=20')
      YIELD value
      RETURN value
    `);
    
    if (result.records.length === 0) {
      console.log('No se encontraron datos en la API');
      return;
    }
    
    const apiData = result.records[0].get('value');
    console.log(`Importados ${apiData.message.items.length} artículos desde la API`);
    
    // Procesar cada artículo de la respuesta
    for (const item of apiData.message.items) {
      if (!item.DOI) continue; // Saltamos elementos sin DOI
      
      // Crear el artículo
      await session.run(`
        CALL apoc.create.node(['Paper'], {
          doi: $doi,
          title: $title,
          type: $type,
          published: $published,
          url: $url
        }) YIELD node AS paper
        RETURN paper
      `, {
        doi: item.DOI,
        title: item.title ? item.title[0] : "Sin título",
        type: item.type || "unknown",
        published: item.published ? item.published['date-parts'][0][0] : null,
        url: `https://doi.org/${item.DOI}`
      });
      
      // Crear y relacionar la revista/publicación
      if (item['container-title'] && item['container-title'].length > 0) {
        await session.run(`
          MERGE (j:Journal {name: $journalName})
          WITH j
          MATCH (p:Paper {doi: $doi})
          CALL apoc.create.relationship(p, 'PUBLISHED_IN', {}, j) YIELD rel
          RETURN rel
        `, {
          journalName: item['container-title'][0],
          doi: item.DOI
        });
      }
      
      // Crear y relacionar autores
      if (item.author) {
        for (let i = 0; i < item.author.length; i++) {
          const author = item.author[i];
          const authorName = author.given && author.family ? 
                            `${author.given} ${author.family}` : 
                            (author.family || "Autor Desconocido");
          
          await session.run(`
            MERGE (a:Author {name: $name})
            ON CREATE SET a.id = apoc.create.uuid()
            WITH a
            MATCH (p:Paper {doi: $doi})
            CALL apoc.create.relationship(a, 'WROTE', {order: $order}, p) YIELD rel
            RETURN rel
          `, {
            name: authorName,
            doi: item.DOI,
            order: i
          });
        }
      }
      
      // Extraer y relacionar palabras clave del título
      if (item.title && item.title.length > 0) {
        const title = item.title[0];
        // Generar keywords simples del título (quitar palabras comunes)
        const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'with'];
        const keywords = title
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter(word => word.length > 3 && !stopWords.includes(word));
        
        for (const keyword of keywords) {
          await session.run(`
            MERGE (k:Keyword {term: $term})
            WITH k
            MATCH (p:Paper {doi: $doi})
            CALL apoc.create.relationship(p, 'HAS_KEYWORD', {}, k) YIELD rel
            RETURN rel
          `, {
            term: keyword,
            doi: item.DOI
          });
        }
      }
    }
    
    console.log('Datos importados y procesados correctamente');
  } catch (error) {
    console.error('Error al importar datos desde la API:', error);
  }
};

// 3. Crear relaciones entre artículos basadas en co-autores y palabras clave similares
const createPaperRelationships = async () => {
  try {
    // Relacionar papers que comparten autores
    await session.run(`
      MATCH (a:Author)-[:WROTE]->(p1:Paper)
      MATCH (a)-[:WROTE]->(p2:Paper)
      WHERE p1 <> p2
      MERGE (p1)-[r:SHARES_AUTHOR]->(p2)
      ON CREATE SET r.weight = 1
      ON MATCH SET r.weight = r.weight + 1
    `);
    
    // Relacionar papers que comparten keywords
    await session.run(`
      MATCH (p1:Paper)-[:HAS_KEYWORD]->(k:Keyword)<-[:HAS_KEYWORD]-(p2:Paper)
      WHERE p1 <> p2
      MERGE (p1)-[r:RELATED_TO]->(p2)
      ON CREATE SET r.weight = 1
      ON MATCH SET r.weight = r.weight + 1
    `);
    
    // Identificar posibles citas usando apoc.path.expand
    // Asumimos que papers más antiguos con keywords similares pueden ser citados
    await session.run(`
      MATCH (p1:Paper)
      CALL apoc.path.expand(p1, "RELATED_TO|SHARES_AUTHOR", null, 1, 2) YIELD path
      WITH p1, last(nodes(path)) AS p2
      WHERE p1.published > p2.published
      MERGE (p1)-[r:POTENTIALLY_CITES]->(p2)
    `);
    
    console.log('Relaciones entre artículos creadas correctamente');
  } catch (error) {
    console.error('Error al crear relaciones entre artículos:', error);
  }
};

// 4. Generar citaciones en formato APA para cada artículo
const generateCitations = async () => {
  try {
    const result = await session.run(`
      MATCH (p:Paper)
      OPTIONAL MATCH (p)<-[:WROTE]-(a:Author)
      OPTIONAL MATCH (p)-[:PUBLISHED_IN]->(j:Journal)
      WITH p, collect(a.name) as authors, j.name as journal, p.published as year
      RETURN p.doi as doi, p.title as title, authors, journal, year
      ORDER BY p.published DESC
    `);
    
    console.log('\n==== CITACIONES EN FORMATO APA ====');
    result.records.forEach(record => {
      const doi = record.get('doi');
      const title = record.get('title');
      const authors = record.get('authors');
      const journal = record.get('journal');
      const year = record.get('year');
      
      let citation = '';
      
      // Formato de autores
      if (authors && authors.length > 0) {
        if (authors.length === 1) {
          citation += `${authors[0]}`;
        } else if (authors.length === 2) {
          citation += `${authors[0]} & ${authors[1]}`;
        } else if (authors.length > 2) {
          citation += `${authors[0]} et al.`;
        }
      } else {
        citation += 'Autor desconocido';
      }
      
      // Añadir año
      citation += ` (${year || 'n.d.'}).`;
      
      // Añadir título
      citation += ` ${title}.`;
      
      // Añadir revista
      if (journal) {
        citation += ` ${journal}`;
      }
      
      // Añadir DOI
      citation += ` https://doi.org/${doi}`;
      
      console.log(citation);
    });
  } catch (error) {
    console.error('Error al generar citaciones:', error);
  }
};

// 5. Función para analizar la red y encontrar autores influyentes
const analyzeNetwork = async () => {
  try {
    console.log('\n==== ANÁLISIS DE LA RED BIBLIOGRÁFICA ====');
    
    // Encontrar autores más prolíficos
    const topAuthors = await session.run(`
      MATCH (a:Author)-[:WROTE]->(p:Paper)
      WITH a, count(p) AS papers
      RETURN a.name AS author, papers
      ORDER BY papers DESC
      LIMIT 5
    `);
    
    console.log('\nAutores más prolíficos:');
    topAuthors.records.forEach(record => {
      console.log(`${record.get('author')}: ${record.get('papers')} artículos`);
    });
    
    // Encontrar palabras clave más comunes
    const topKeywords = await session.run(`
      MATCH (k:Keyword)<-[:HAS_KEYWORD]-(p:Paper)
      WITH k, count(p) AS papers
      RETURN k.term AS keyword, papers
      ORDER BY papers DESC
      LIMIT 10
    `);
    
    console.log('\nPalabras clave más comunes:');
    topKeywords.records.forEach(record => {
      console.log(`${record.get('keyword')}: ${record.get('papers')} artículos`);
    });
    
    // Encontrar rutas de conocimiento usando apoc.path.expand
    const knowledgePaths = await session.run(`
      MATCH (start:Paper)
      WHERE start.published IS NOT NULL
      WITH start ORDER BY start.published DESC LIMIT 1
      CALL apoc.path.expand(start, "POTENTIALLY_CITES", null, 1, 3) YIELD path
      RETURN [node in nodes(path) | 
        CASE 
          WHEN node:Paper THEN node.title
          ELSE null
        END] AS knowledgePath,
        length(path) AS pathLength
      ORDER BY pathLength DESC
      LIMIT 3
    `);
    
    console.log('\nRutas de conocimiento (cadenas de posible citación):');
    knowledgePaths.records.forEach(record => {
      const path = record.get('knowledgePath').filter(node => node !== null);
      console.log(`${path.join(' → ')}`);
    });
    
  } catch (error) {
    console.error('Error al analizar la red:', error);
  }
};

// Ejecutar todas las funciones en secuencia
const runDemo = async () => {
  try {
    await clearDatabase();
    await setupSchema();
    await importPapersFromAPI();
    await createPaperRelationships();
    await generateCitations();
    await analyzeNetwork();
    
    console.log('\nDemostración de red bibliográfica completada con éxito');
  } catch (error) {
    console.error('Error en la demostración:', error);
  } finally {
    session.close();
    driver.close();
  }
};

// Iniciar la demostración
runDemo();