import * as THREE from './three.js/three.module.min.js';

export default class VolumeSamplers {
    /**
     * Creates a signed distance sampler from a THREE.Mesh instance.
     *
     * @param {THREE.Mesh} instance A THREE.Mesh object. Its geometry must be indexed. Position is constant.
     * @returns {Function}
     *   A sampler function with signature: (x: number, y: number, z: number) => number
     *   Returns the shortest signed distance to the mesh at world-space coordinate (x, y, z).
     *     - Negative = point is inside the mesh
     *     - Positive = point is outside the mesh
     */
    static createMeshInstanceSdfSampler(instance) {
        if (!(instance instanceof THREE.Mesh)) {
            throw new Error('Expected a THREE.Mesh instance');
        }

        instance.updateMatrixWorld(true);

        return VolumeSamplers.createGeometrySdfSampler(instance.geometry, instance.matrixWorld);
    }

    /**
     * Creates a signed distance sampler from a geometry object and world transform.
     *
     * @param {THREE.BufferGeometry} geometry An indexed THREE.BufferGeometry.
     * @param {THREE.Matrix4} transform The world transform.
     * @returns {Function}
     *   A sampler function with signature: (x: number, y: number, z: number) => number
     *   Returns the shortest signed distance to the mesh at world-space coordinate (x, y, z).
     *     - Negative = point is inside the mesh
     *     - Positive = point is outside the mesh
     */
    static createGeometrySdfSampler(geometry, transform = new THREE.Matrix4()) {
        if (!geometry.index) {
            throw new Error('Geometry must be indexed');
        }

        // Temporary vectors to avoid allocations
        const va = new THREE.Vector3();
        const vb = new THREE.Vector3();
        const vc = new THREE.Vector3();

        const ab = new THREE.Vector3();
        const ac = new THREE.Vector3();
        const bc = new THREE.Vector3();

        const ap = new THREE.Vector3();
        const bp = new THREE.Vector3();
        const cp = new THREE.Vector3();

        const n = new THREE.Vector3();
        const p = new THREE.Vector3();
        const q = new THREE.Vector3();

        const bestPoint = new THREE.Vector3();
        const bestNormal = new THREE.Vector3();

        const toPoint = new THREE.Vector3();

        const position = geometry.attributes.position;
        const index = geometry.index.array;

        // Precompute world-space vertices once
        const worldPositions = new Array(position.count);
        for (let i = 0; i < position.count; i++) {
            worldPositions[i] = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(transform);
        }

        // Closest point on triangle algorithm based on Christer Ericson's book "Real-Time Collision Detection"
        const closestPointOnTriangle = (p, a, b, c, target) => {
            ab.subVectors(b, a);
            ac.subVectors(c, a);
            ap.subVectors(p, a);

            const d1 = ab.dot(ap);
            const d2 = ac.dot(ap);
            if (d1 <= 0 && d2 <= 0) {
                return target.copy(a);
            }

            bp.subVectors(p, b);
            const d3 = ab.dot(bp);
            const d4 = ac.dot(bp);
            if (d3 >= 0 && d4 <= d3) {
                return target.copy(b);
            }

            cp.subVectors(p, c);
            const d5 = ab.dot(cp);
            const d6 = ac.dot(cp);
            if (d6 >= 0 && d5 <= d6) {
                return target.copy(c);
            }

            if (d1 * d4 - d3 * d2 <= 0 && d1 >= 0 && d3 <= 0) {
                const v = d1 / (d1 - d3);
                return target.copy(a).add(ab.multiplyScalar(v));
            }

            if (d5 * d2 - d1 * d6 <= 0 && d2 >= 0 && d6 <= 0) {
                const w = d2 / (d2 - d6);
                return target.copy(a).add(ac.multiplyScalar(w));
            }

            if (d3 * d6 - d5 * d4 <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
                const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
                bc.subVectors(c, b);
                return target.copy(b).add(bc.multiplyScalar(w));
            }

            n.crossVectors(ab, ac).normalize();
            const distance = n.dot(ap);
            return target.copy(p).sub(n.multiplyScalar(distance));
        };

        // Return the sampler function
        return (x, y, z) => {
            p.set(x, y, z);

            let closestDistance2 = Infinity;

            for (let i = 0; i < index.length; i += 3) {
                va.copy(worldPositions[index[i]]);
                vb.copy(worldPositions[index[i + 1]]);
                vc.copy(worldPositions[index[i + 2]]);

                closestPointOnTriangle(p, va, vb, vc, q);
                const distance2 = p.distanceToSquared(q);

                if (distance2 < closestDistance2) {
                    closestDistance2 = distance2;
                    bestPoint.copy(q);

                    ab.subVectors(vb, va);
                    ac.subVectors(vc, va);
                    bestNormal.crossVectors(ab, ac).normalize();
                }
            }

            toPoint.subVectors(p, bestPoint);
            const dot = toPoint.dot(bestNormal);
            const sign = dot >= 0 ? 1 : -1;
            return Math.sqrt(closestDistance2) * sign;
        };
    }
}

