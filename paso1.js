import neo4j from 'neo4j-driver';

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('architect', 'architect2024')
);

const session = driver.session({
  database: 'actividadneo4j',
  defaultAccessMode: neo4j.session.WRITE
});

// Query para crear la red social
const createSocialNetwork = `
// Crear usuarios
CREATE (maria:Person {name: 'María', age: 25, city: 'Madrid'})
CREATE (juan:Person {name: 'Juan', age: 30, city: 'Barcelona'})
CREATE (ana:Person {name: 'Ana', age: 28, city: 'Valencia'})
CREATE (pedro:Person {name: 'Pedro', age: 35, city: 'Madrid'})

// Crear publicaciones
CREATE (post1:Post {content: '¡Qué día tan bonito!', date: date()})
CREATE (post2:Post {content: 'Me encanta programar con Neo4j', date: date()})
CREATE (post3:Post {content: 'Viajando por España', date: date()})

// Crear relaciones de seguimiento
CREATE (maria)-[:FOLLOWS]->(juan)
CREATE (maria)-[:FOLLOWS]->(ana)
CREATE (juan)-[:FOLLOWS]->(maria)
CREATE (ana)-[:FOLLOWS]->(maria)
CREATE (pedro)-[:FOLLOWS]->(maria)
CREATE (pedro)-[:FOLLOWS]->(juan)

// Crear relaciones de publicaciones
CREATE (maria)-[:POSTED]->(post1)
CREATE (juan)-[:POSTED]->(post2)
CREATE (ana)-[:POSTED]->(post3)

// Crear relaciones de likes
CREATE (maria)-[:LIKES]->(post2)
CREATE (juan)-[:LIKES]->(post1)
CREATE (ana)-[:LIKES]->(post1)
CREATE (ana)-[:LIKES]->(post2)
CREATE (pedro)-[:LIKES]->(post1)
`;

// Ejecutar la query
async function main() {
  try {
    await session.run(createSocialNetwork);
    console.log('Red social creada exitosamente');

    // Mostrar algunas consultas de ejemplo
    const queries = [
      {
        name: 'Usuarios y sus seguidores',
        query: 'MATCH (p:Person)<-[r:FOLLOWS]-(follower) RETURN p.name as persona, collect(follower.name) as seguidores'
      },
      {
        name: 'Publicaciones con sus likes',
        query: 'MATCH (post:Post)<-[r:LIKES]-(liker:Person) RETURN post.content as publicacion, collect(liker.name) as likes'
      },
      {
        name: 'Usuarios más activos (con más publicaciones)',
        query: 'MATCH (p:Person)-[:POSTED]->(post) RETURN p.name as usuario, count(post) as num_publicaciones'
      }
    ];

    for (const q of queries) {
      console.log(`\n${q.name}:`);
      const result = await session.run(q.query);
      result.records.forEach(record => {
        console.log(record.toObject());
      });
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await session.close();
    await driver.close();
  }
}

main();