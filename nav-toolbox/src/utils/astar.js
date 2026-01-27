export function findPath(nodes, startId, endId) {
    // nodes: { id: { x, y, neighbors: [id, dist] } }

    // Heuristic: Euclidean distance
    const h = (id) => {
        const n = nodes[id];
        const end = nodes[endId];
        return Math.hypot(n.x - end.x, n.y - end.y);
    };

    const openSet = [startId];
    const cameFrom = {};
    const gScore = {}; // Cost from start
    const fScore = {}; // Estimated total cost

    // Initialize scores
    Object.keys(nodes).forEach(id => {
        gScore[id] = Infinity;
        fScore[id] = Infinity;
    });

    gScore[startId] = 0;
    fScore[startId] = h(startId);

    while (openSet.length > 0) {
        // Get node with lowest fScore
        let current = openSet.reduce((a, b) => fScore[a] < fScore[b] ? a : b);

        if (current === endId) {
            // Reconstruct path
            const path = [current];
            while (cameFrom[current]) {
                current = cameFrom[current];
                path.unshift(current);
            }
            return path;
        }

        // Remove current from openSet
        openSet.splice(openSet.indexOf(current), 1);

        // Neighbors
        const neighbors = nodes[current].neighbors;
        for (let nextId of neighbors) {
            // Assume neighbor list is locally stored or calculated. 
            // Here assuming nodes[id].neighbors is array of IDs. 
            // Dist is Euclidean
            const dist = Math.hypot(nodes[current].x - nodes[nextId].x, nodes[current].y - nodes[nextId].y);

            const tentativeG = gScore[current] + dist;

            if (tentativeG < gScore[nextId]) {
                cameFrom[nextId] = current;
                gScore[nextId] = tentativeG;
                fScore[nextId] = gScore[nextId] + h(nextId);

                if (!openSet.includes(nextId)) {
                    openSet.push(nextId);
                }
            }
        }
    }
    return null; // No path
}
