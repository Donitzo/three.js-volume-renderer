import * as THREE from './three.js/three.module.min.js';

const vertexShader = `
varying vec2 vUv;
varying float near;
varying float far;
varying mat4 invProjView;

void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
    vUv = uv;
    near = projectionMatrix[3][2] / (projectionMatrix[2][2] - 1.0);
    far = projectionMatrix[3][2] / (projectionMatrix[2][2] + 1.0);
    invProjView = inverse(projectionMatrix * viewMatrix);
}`;

const fragmentShader = `
// RAY_STEPS:
//   The number of steps to split the ray into across the volume.

#if RENDER_MEAN_VALUE == 0 && (USE_POINT_LIGHTS || USE_DIR_LIGHTS) || RENDER_NORMALS
// The real-unit epsilon used when estimating the forward difference for normals
uniform float normalEpsilon;
#endif

#if RENDER_NORMALS == 0
// Horizontal palette texture
uniform sampler2D palette;
// The clamped palette value range
uniform float minPaletteValue;
uniform float maxPaletteValue;
#endif
// Value multiplier
uniform float valueMultiplier;
// Values outside this range are ignored (affects alpha blending and mean calculations)
uniform float minCutoffValue;
uniform float maxCutoffValue;

#if RENDER_MEAN_VALUE == 0 && USE_EXTINCTION_COEFFICIENT && RENDER_NORMALS == 0
 #if USE_VALUE_AS_EXTINCTION_COEFFICIENT == 0
// Fixed extinction coefficient
uniform float extinctionCoefficient;
 #endif
// Extinction coefficient multiplier
uniform float extinctionMultiplier;
#endif

#if RENDER_NORMALS == 0
// Final color alpha multiplier
uniform float alphaMultiplier;

 #if RENDER_MEAN_VALUE == 0
// Range inside the cutoff at which the alpha fades to zero
uniform float cutoffFadeRange;
 #endif
#endif

// The current time (fractional volume index or time in sampleValue)
uniform float time;

// Random value used when initializing rays.
uniform float random;

#if USE_VOLUMETRIC_DEPTH_TEST
// Depth texture
uniform sampler2D depthTexture;
#endif

// The world-space origin of the volume
uniform vec3 volumeOrigin;
#if USE_CUSTOM_VALUE_FUNCTION
// The world-space size of the volume
uniform vec3 volumeSize;

// The injected function sampling a value from a position + time
float sampleValue(float x, float y, float z, float t) {
{function}
}
#else
// A 3D texture atlas storing multiple volumes
uniform sampler3D volumeAtlas;
// The resolution of the volume atlas (number of volumes in X, Y, Z)
uniform vec3 atlasResolution;
// The number of voxels in a single volume
uniform vec3 volumeResolution;
// The physical size of a single voxel
uniform vec3 voxelSize;
// The number of timesteps (volumes) stored in the atlas, ignoring unused volumes
uniform float timeCount;

// Sample and interpolate a value from the volume atlas
float sampleValue(vec3 position, vec3 volumeUvOffset0, vec3 volumeUvOffset1, float volumeT) {
    // Transform the position into voxel/UV coordinates inside the volume
    // Assumes that the origin is centered on the first voxel
    vec3 volumeVoxel = (position - volumeOrigin) / voxelSize;
    vec3 volumeUv = (volumeVoxel + 0.5) / volumeResolution;

    // Calculate UV coordinates inside the individual volumes
    vec3 uv0 = volumeUvOffset0 + volumeUv / atlasResolution;
    vec3 uv1 = volumeUvOffset1 + volumeUv / atlasResolution;

    // Sample the values from the volume atlas
    float value0 = texture(volumeAtlas, uv0).r;
    float value1 = texture(volumeAtlas, uv1).r;

    // Interpolate between volumes
    return mix(value0, value1, volumeT);
}
#endif

#if (USE_POINT_LIGHTS || USE_DIR_LIGHTS) && RENDER_NORMALS == 0
// Light uniforms
 #if USE_POINT_LIGHTS && NUM_POINT_LIGHTS > 0
struct PointLight {
    vec3 color;
    vec3 position;
    float distance;
};
uniform PointLight pointLights[NUM_POINT_LIGHTS];
 #endif
 #if USE_DIR_LIGHTS && NUM_DIR_LIGHTS > 0
struct DirectionalLight {
    vec3 direction;
    vec3 color;
};
uniform DirectionalLight directionalLights[NUM_DIR_LIGHTS];
 #endif
#endif

varying vec2 vUv;
varying float near;
varying float far;
varying mat4 invProjView;

void main() {
    // Calculate the world position of the far plane using the plane UV coordinate
    vec4 farWorld = invProjView * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    farWorld /= farWorld.w;

    // Cast a ray from the camera to the near plane
    vec3 rayOrigin = cameraPosition;
    vec3 rayDirection = normalize(farWorld.xyz - rayOrigin);

#if USE_VOLUMETRIC_DEPTH_TEST
    // Sample depth
    float z = texture(depthTexture, vUv).r;
    float depth = -((near * far) / ((far - near) * z - far));
#endif

#if USE_CUSTOM_VALUE_FUNCTION == 0
    // Calculate the volume size and max coordinate
    vec3 volumeSize = volumeResolution * voxelSize;
    // Minus one voxel since they are centered
    vec3 volumeMax = volumeOrigin + (volumeResolution - 1.0) * voxelSize;

    // Calculate the volume indices and interpolation factor
    int volumeIndex0 = int(time) % int(timeCount);
    int volumeIndex1 = (volumeIndex0 + 1) % int(timeCount);
    float volumeT = fract(time);

    // Calculate the 3D volume indices
    int atlasResolutionX = int(atlasResolution.x);
    int atlasResolutionY = int(atlasResolution.y);
    int atlasResolutionZ = int(atlasResolution.z);

    int volume0X = volumeIndex0 % atlasResolutionX;
    int volume0Y = (volumeIndex0 / atlasResolutionX) % atlasResolutionY;
    int volume0Z = volumeIndex0 / (atlasResolutionX * atlasResolutionY);

    int volume1X = volumeIndex1 % atlasResolutionX;
    int volume1Y = (volumeIndex1 / atlasResolutionX) % atlasResolutionY;
    int volume1Z = volumeIndex1 / (atlasResolutionX * atlasResolutionY);

    // Calculate the volume UV offsets
    vec3 volumeUvOffset0 = vec3(float(volume0X), float(volume0Y), float(volume0Z)) / atlasResolution;
    vec3 volumeUvOffset1 = vec3(float(volume1X), float(volume1Y), float(volume1Z)) / atlasResolution;
#else
    // Calculate the volume max coordinate
    vec3 volumeMax = volumeOrigin + volumeSize;
#endif

    // Calculate ray-box intersection
    vec3 t1 = (volumeOrigin - rayOrigin) / rayDirection;
    vec3 t2 = (volumeMax - rayOrigin) / rayDirection;

    vec3 tMin = min(t1, t2);
    vec3 tMax = max(t1, t2);

    float tNear = max(max(tMin.x, tMin.y), tMin.z);
    float tFar = min(min(tMax.x, tMax.y), tMax.z);

    // If the ray starts outside the volume and does not hit the box, discard the fragment
    bool insideBox = all(greaterThanEqual(rayOrigin, volumeOrigin)) &&
        all(lessThanEqual(rayOrigin, volumeMax));

    if (!insideBox && (tNear > tFar || tFar < 0.0)) {
        discard;
    }

    // Calculate the ray entry and exit points on the volume
    vec3 entryPoint = insideBox ? rayOrigin : rayOrigin + rayDirection * tNear;
    vec3 exitPoint = rayOrigin + rayDirection * tFar;

    // Calculate the total volume ray intersection and step length
    float intersectionLength = length(exitPoint - entryPoint);
    float stepLength = intersectionLength / float(RAY_STEPS);

#if RENDER_NORMALS == 0
 #if RENDER_MEAN_VALUE
    // Accumulators for the mean value
    float valueSum = 0.0;
    float weightSum = 0.0;
 #else
    // Final color in front-to-back blending
    vec4 alphaBlendedColor = vec4(0.0);
 #endif
#else
    // Transparent until a surface is hit
    gl_FragColor = vec4(0.0);
#endif

#if USE_RANDOM_START
    // Add a random offset to the ray start length to 'fuzz' sharp edges
    float rand = mod(random + fract(sin(dot(rayDirection, vec3(12.9898, 78.233, 45.164))) * 43758.5453), 1.0);
    // Keep track of the total ray distance
    float currentRayLength = stepLength * (rand - 1.0) + 1e-6;
#else
    // Keep track of the total ray distance
    float currentRayLength = -stepLength + 1e-6;
#endif

    // Loop over the ray steps
    for (int i = 0; i < RAY_STEPS; i++) {
        // Advance the ray
        currentRayLength += stepLength;

        // Mask steps outside the bounding volume (a mask is used to avoid conditional branching)
        float stepWeight = 1.0 - step(intersectionLength - 1e-6, currentRayLength);

        // Interpolate the current position along the ray
        vec3 position = mix(entryPoint, exitPoint, currentRayLength / intersectionLength);

        // Sample value at ray position
#if USE_CUSTOM_VALUE_FUNCTION
        vec3 local = position - volumeOrigin;
        float sampledValue = sampleValue(local.x, local.y, local.z, time);
#else
        float sampledValue = sampleValue(position, volumeUvOffset0, volumeUvOffset1, volumeT);
#endif
        float scaledValue = sampledValue * valueMultiplier;

        // Only consider values inside the cutoff range
        stepWeight *= step(minCutoffValue, scaledValue) * step(scaledValue, maxCutoffValue);

#if USE_VOLUMETRIC_DEPTH_TEST
        // Mask areas behind the depth buffer
        stepWeight *= step(currentRayLength + tNear, depth);
#endif

#if RENDER_MEAN_VALUE && RENDER_NORMALS == 0
        // Accumulate weighted value for the mean value
        valueSum += scaledValue * stepLength * stepWeight;
        weightSum += stepLength * stepWeight;
#else
 #if USE_POINT_LIGHTS || USE_DIR_LIGHTS || RENDER_NORMALS
        // Approximate normal using forward difference
  #if USE_CUSTOM_VALUE_FUNCTION
        vec3 delta = vec3(
            sampleValue(local.x + normalEpsilon, local.y, local.z, time) - sampledValue,
            sampleValue(local.x, local.y + normalEpsilon, local.z, time) - sampledValue,
            sampleValue(local.x, local.y, local.z + normalEpsilon, time) - sampledValue);
  #else
        vec3 delta = vec3(
            sampleValue(position + vec3(normalEpsilon, 0.0, 0.0), volumeUvOffset0, volumeUvOffset1, volumeT) - sampledValue,
            sampleValue(position + vec3(0.0, normalEpsilon, 0.0), volumeUvOffset0, volumeUvOffset1, volumeT) - sampledValue,
            sampleValue(position + vec3(0.0, 0.0, normalEpsilon), volumeUvOffset0, volumeUvOffset1, volumeT) - sampledValue);
  #endif
        delta = mix(vec3(0, 1, 0), delta, step(1e-7, dot(delta, delta)));
  #if INVERT_NORMALS
        vec3 normal = normalize(-delta);
  #else
        vec3 normal = normalize(delta);
  #endif

  #if RENDER_NORMALS
        // Render the normal when hitting the first surface
        if (stepWeight > 0.0) {
            gl_FragColor = vec4(normal * 0.5 + vec3(0.5), 1.0);
            break;
        }
  #else
        // Sum up lighting
        vec3 addedLights = vec3(0.0);

        // Transform world position and normal into view space
        vec3 viewPosition = (viewMatrix * vec4(position, 1.0)).xyz;
        vec3 viewNormal = normalize((viewMatrix * vec4(normal, 0.0)).xyz);

   #if USE_POINT_LIGHTS && NUM_POINT_LIGHTS > 0
        for(int l = 0; l < NUM_POINT_LIGHTS; l++) {
            vec3 lightDirection = normalize(pointLights[l].position - viewPosition);
            float strength = max(1.0 - (distance(viewPosition, pointLights[l].position) / pointLights[l].distance), 0.0);
            addedLights += clamp(dot(lightDirection, viewNormal), 0.0, 1.0) * pointLights[l].color * strength;
        }
   #endif
   #if USE_DIR_LIGHTS && NUM_DIR_LIGHTS > 0
        for(int l = 0; l < NUM_DIR_LIGHTS; l++) {
            vec3 lightDirection = directionalLights[l].direction;
            addedLights += clamp(dot(lightDirection, viewNormal), 0.0, 1.0) * directionalLights[l].color;
        }
   #endif
  #endif
 #endif

 #if RENDER_NORMALS == 0
        // Remap the value to the [0, 1] range
        float normalizedValue = clamp((scaledValue - minPaletteValue) / (maxPaletteValue - minPaletteValue), 0.0, 1.0);

  #if USE_EXTINCTION_COEFFICIENT == 0
        float alpha = 1.0;
  #elif USE_VALUE_AS_EXTINCTION_COEFFICIENT
        // Calculate the blending alpha from the value as extinction coefficient
        float alpha = 1.0 - exp(-scaledValue * extinctionMultiplier * stepLength);
  #else
        // Calculate the blending alpha from the extinction coefficient
        float alpha = 1.0 - exp(-extinctionCoefficient * extinctionMultiplier * stepLength);
  #endif
        // If ignored, set 0 alpha
        alpha *= stepWeight * alphaMultiplier;

        // Calculate edge opacity (fades out values near the cutoff range)
        alpha *= smoothstep(0.0, cutoffFadeRange + 1e-6, min(scaledValue - minCutoffValue, maxCutoffValue - scaledValue));

        // Sample the palette to get color
        vec4 color = vec4(texture(palette, vec2(normalizedValue, 0.5)).rgb, alpha);

  #if USE_POINT_LIGHTS || USE_DIR_LIGHTS
        // Apply lighting to only color
        color.rgb *= addedLights;
  #endif

        // Front-to-back alpha blending
        alphaBlendedColor.rgb += color.rgb * color.a * (1.0 - alphaBlendedColor.a);
        alphaBlendedColor.a += (1.0 - alphaBlendedColor.a) * color.a;
 #endif
#endif
    }

#if RENDER_NORMALS == 0
 #if RENDER_MEAN_VALUE
    // Calculate the mean value
    float meanValue = valueSum / max(weightSum, 1e-6);
    float normalizedMean = clamp((meanValue - minPaletteValue) / (maxPaletteValue - minPaletteValue), 1e-7, 1.0 - 1e-7);

    // Sample the mean color from the palette
    float alpha = step(minCutoffValue, meanValue) * step(meanValue, maxCutoffValue) * alphaMultiplier;
    gl_FragColor = vec4(texture(palette, vec2(normalizedMean, 0.5)).rgb * alpha, alpha);
 #else
    // Use the alpha blended color
    gl_FragColor = alphaBlendedColor;
 #endif
#endif
}`;

/**
 * Combined shader uniforms.
 *
 * Uniform properties:
 *
 * @property {THREE.Texture|null} depthTexture
 *   - Depth texture for volumetric depth testing.
 *     [Active only if USE_VOLUMETRIC_DEPTH_TEST is enabled]
 *
 * @property {THREE.Vector3} volumeOrigin
 *   - The world-space origin of the volume.
 *
 * @property {THREE.Vector3} volumeSize
 *   - The world-space size of the volume.
 *     [Active only when USE_CUSTOM_VALUE_FUNCTION is enabled]
 *
 * @property {THREE.Data3DTexture|null} volumeAtlas
 *   - The 3D texture containing packed volume data.
 *     [Active only when USE_CUSTOM_VALUE_FUNCTION is disabled]
 *
 * @property {THREE.Vector3} atlasResolution
 *   - Number of volumes packed along each axis in the atlas.
 *     [Active only when USE_CUSTOM_VALUE_FUNCTION is disabled]
 *
 * @property {THREE.Vector3} volumeResolution
 *   - Resolution (voxel count) of a single volume.
 *     [Active only when USE_CUSTOM_VALUE_FUNCTION is disabled]
 *
 * @property {THREE.Vector3} voxelSize
 *   - The physical size of a single voxel.
 *     [Active only when USE_CUSTOM_VALUE_FUNCTION is disabled]
 *
 * @property {number} timeCount
 *   - Total number of volumes (timesteps) stored in the atlas.
 *     [Active only when USE_CUSTOM_VALUE_FUNCTION is disabled]
 *
 * @property {number} time
 *   - The current time, represented either as a fractional volume index or a time value for the custom function.
 *
 * @property {number} random
 *   - A random value used when initializing rays.
 *
 * @property {THREE.Texture|null} palette
 *   - Horizontal palette texture for mapping sampled values to colors.
 *     [Active only when RENDER_NORMALS is disabled]
 *
 * @property {number} minPaletteValue
 *   - The minimum value used for palette mapping.
 *     [Active only when RENDER_NORMALS is disabled]
 *
 * @property {number} maxPaletteValue
 *   - The maximum value used for palette mapping.
 *     [Active only when RENDER_NORMALS is disabled]
 *
 * @property {number} minCutoffValue
 *   - Minimum cutoff value. Values below this threshold are discarded.
 *
 * @property {number} maxCutoffValue
 *   - Maximum cutoff value. Values above this threshold are discarded.
 *
 * @property {number} cutoffFadeRange
 *   - Cutoff Fade Range over which the alpha fades to zero.
 *
 * @property {number} valueMultiplier
 *   - Multiplier applied to sampled values.
 *
 * @property {number} extinctionCoefficient
 *   - Fixed extinction coefficient used for alpha blending.
 *     [Active only when USE_EXTINCTION_COEFFICIENT is enabled, USE_VALUE_AS_EXTINCTION_COEFFICIENT and RENDER_NORMALS is disabled]
 *
 * @property {number} extinctionMultiplier
 *   - Multiplier applied to the extinction coefficient.
 *     [Active only when USE_EXTINCTION_COEFFICIENT is enabled and RENDER_NORMALS is disabled]
 *
 * @property {number} alphaMultiplier
 *   - Multiplier applied to the final alpha value.
 *     [Active only when RENDER_NORMALS is disabled]
 *
 * @property {number} normalEpsilon
 *   - Real-unit epsilon used for estimating normals via forward differences.
 *     [Active when RENDER_NORMALS is enabled, or when RENDER_MEAN_VALUE is disabled and (USE_POINT_LIGHTS or USE_DIR_LIGHTS) is enabled]
 */

export default class VolumeRenderer extends THREE.Mesh {
    uniforms = {
        depthTexture:          { value: null },

        volumeOrigin:          { value: new THREE.Vector3() },
        volumeSize:            { value: new THREE.Vector3() },

        volumeAtlas:           { value: null },
        atlasResolution:       { value: new THREE.Vector3() },
        volumeResolution:      { value: new THREE.Vector3() },
        voxelSize:             { value: new THREE.Vector3() },
        timeCount:             { value: 0.0 },

        time:                  { value: 0.0 },
        random:                { value: 0.0 },

        normalEpsilon:         { value: 0.01 },

        palette:               { value: null },
        minPaletteValue:       { value: 0.0 },
        maxPaletteValue:       { value: 1.0 },
        minCutoffValue:        { value: 1e-3 },
        maxCutoffValue:        { value: 1.0 - 1e-3 },
        cutoffFadeRange:       { value: 0.0 },
        valueMultiplier:       { value: 1.0 },

        extinctionCoefficient: { value: 1.0 },
        extinctionMultiplier:  { value: 1.0 },

        alphaMultiplier:       { value: 1.0 },
    };

    constructor() {
        super(new THREE.PlaneGeometry(2, 2));

        this.name = 'VolumeRenderer';

        // Render the volume late as it acts as a postprocessing effect
        this.renderOrder = 1000;

        this.updateMaterial();
    }

    /**
     * Creates a new shader material based on the provided options.
     *
     * @param {Object} [options={}] - An object containing configuration options.
     * @param {string|null} [options.customFunction=null] - A custom shader function to inject into the fragment shader.
     * @param {boolean} [options.useVolumetricDepthTest=false] - Whether to enable volumetric depth testing.
     * @param {boolean} [options.useExtinctionCoefficient=true] - Whether to use the extinction coefficient in alpha blending.
     * @param {boolean} [options.useValueAsExtinctionCoefficient=false] - Whether to use the sampled value as the extinction coefficient.
     * @param {boolean} [options.usePointLights=false] - Whether to enable point lights in the scene.
     * @param {boolean} [options.useDirectionalLights=false] - Whether to enable directional lights in the scene.
     * @param {boolean} [options.useRandomStart=true] - Whether to randomize the ray start position to 'fuzz' sharp edges.
     * @param {boolean} [options.renderMeanValue=false] - Whether to accumulate and render the mean value across the volume.
     * @param {boolean} [options.invertNormals=false] - Whether to invert all surface normals.
     * @param {boolean} [options.renderNormals=false] - Whether to render normals at the first surface hit.
     * @param {number} [options.raySteps=64] - The number of steps to split the ray into across the volume.
     */
    updateMaterial(options = Object.create(null)) {
        const customFunction = options.customFunction ?? null;

        // Defines changes how the shader is compiled
        const defines = {
            USE_CUSTOM_VALUE_FUNCTION: +(customFunction !== null),
            USE_VOLUMETRIC_DEPTH_TEST: +(options.useVolumetricDepthTest ?? false),
            RENDER_MEAN_VALUE: +(options.renderMeanValue ?? false),
            USE_EXTINCTION_COEFFICIENT: +(options.useExtinctionCoefficient ?? true),
            USE_VALUE_AS_EXTINCTION_COEFFICIENT: +(options.useValueAsExtinctionCoefficient ?? false),
            USE_POINT_LIGHTS: +(options.usePointLights ?? false),
            USE_DIR_LIGHTS: +(options.useDirectionalLights ?? false),
            USE_RANDOM_START: +(options.useRandomStart ?? true),
            INVERT_NORMALS: +(options.invertNormals ?? false),
            RENDER_NORMALS: +(options.renderNormals ?? false),
            RAY_STEPS: options.raySteps ?? 64,
        };

        const lights = !!defines.USE_POINT_LIGHTS || !!defines.USE_DIR_LIGHTS;

        // Put together a new uniforms object referencing only the relevant uniforms
        const uniforms = lights ? THREE.UniformsUtils.merge([THREE.UniformsLib['lights'], {}]) : {};

        uniforms.volumeOrigin = this.uniforms.volumeOrigin;
        uniforms.time = this.uniforms.time;
        uniforms.random = this.uniforms.random;
        uniforms.minCutoffValue = this.uniforms.minCutoffValue;
        uniforms.maxCutoffValue = this.uniforms.maxCutoffValue;
        uniforms.cutoffFadeRange = this.uniforms.cutoffFadeRange;
        uniforms.valueMultiplier = this.uniforms.valueMultiplier;

        if (defines.RENDER_NORMALS || (!defines.RENDER_MEAN_VALUE &&
            (defines.USE_POINT_LIGHTS || defines.USE_DIR_LIGHTS))) {
            uniforms.normalEpsilon = this.uniforms.normalEpsilon;
        }

        if (!defines.RENDER_NORMALS) {
            uniforms.palette = this.uniforms.palette;
            uniforms.minPaletteValue = this.uniforms.minPaletteValue;
            uniforms.maxPaletteValue = this.uniforms.maxPaletteValue;
            uniforms.alphaMultiplier = this.uniforms.alphaMultiplier;
        }

        if (defines.USE_VOLUMETRIC_DEPTH_TEST) {
            uniforms.depthTexture = this.uniforms.depthTexture;
        }

        if (defines.USE_CUSTOM_VALUE_FUNCTION) {
            uniforms.volumeSize = this.uniforms.volumeSize;
        } else {
            uniforms.volumeAtlas = this.uniforms.volumeAtlas;
            uniforms.atlasResolution = this.uniforms.atlasResolution;
            uniforms.volumeResolution = this.uniforms.volumeResolution;
            uniforms.voxelSize = this.uniforms.voxelSize;
            uniforms.timeCount = this.uniforms.timeCount;
        }

        if (!defines.RENDER_MEAN_VALUE) {
            if (!defines.USE_VALUE_AS_EXTINCTION_COEFFICIENT) {
                uniforms.extinctionCoefficient = this.uniforms.extinctionCoefficient;
            }
            uniforms.extinctionMultiplier = this.uniforms.extinctionMultiplier;
        }

        // Dispose of the old material
        if (this.material) {
            this.material.dispose();
        }

        // Create the new material
        this.material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader: defines.USE_CUSTOM_VALUE_FUNCTION ?
                fragmentShader.replace('{function}', customFunction) : fragmentShader,
            uniforms,
            defines,
            depthTest: false,
            depthWrite: false,
            transparent: true,
            premultipliedAlpha: true,
            lights,
        });
    }

    /**
     * Creates a half-precision 3D atlas texture and updates the material uniforms.
     * This function packs one or more "volumes" into a single 3D texture
     * by stacking them along the X, Y, and Z axes in an atlas-like layout.
     *
     * @param {THREE.Vector3} volumeResolution - The resolution of one volume in voxels.
     * @param {THREE.Vector3} volumeOrigin     - The world origin of the volume.
     * @param {THREE.Vector3} voxelSize        - The physical size of a single voxel.
     * @param {number}        timeCount        - Total number of volumes (timesteps) in the atlas.
     * @param {number}        textureFilter    - The three.js texture interpolation mode. Defaults to THREE.LinearFilter.
     */
    createAtlasTexture(volumeResolution, volumeOrigin, voxelSize, timeCount, textureFilter = THREE.LinearFilter) {
        // Calculate how many volumes to pack into the texture atlas
        const atlasResolutionX = Math.ceil(Math.pow(timeCount, 1 / 3));
        const atlasResolutionY = atlasResolutionX;
        const atlasResolutionZ = Math.ceil(timeCount / (atlasResolutionX * atlasResolutionY));
        const atlasResolution = new THREE.Vector3(atlasResolutionX, atlasResolutionY, atlasResolutionZ);

        // Calculate atlas size in voxels
        const textureSizeX = volumeResolution.x * atlasResolutionX;
        const textureSizeY = volumeResolution.y * atlasResolutionY;
        const textureSizeZ = volumeResolution.z * atlasResolutionZ;

        // Create a Uint16Array to store all the voxels
        const voxelCount = textureSizeX * textureSizeY * textureSizeZ;
        const voxels = new Uint16Array(voxelCount);

        // Create the 3D texture
        const texture = new THREE.Data3DTexture(voxels, textureSizeX, textureSizeY, textureSizeZ);
        texture.format = THREE.RedFormat;
        texture.type = THREE.HalfFloatType;
        texture.minFilter = textureFilter;
        texture.magFilter = textureFilter;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.wrapR = THREE.ClampToEdgeWrapping;

        // Dispose of old texture
        if (this.uniforms.volumeAtlas.value !== null) {
            this.uniforms.volumeAtlas.value.dispose();
        }

        // Update uniforms
        this.uniforms.volumeAtlas.value = texture;
        this.uniforms.volumeAtlas.data = voxels;
        this.uniforms.atlasResolution.value.copy(atlasResolution);
        this.uniforms.volumeResolution.value.copy(volumeResolution);
        this.uniforms.volumeOrigin.value.copy(volumeOrigin);
        this.uniforms.voxelSize.value.copy(voxelSize);
        this.uniforms.timeCount.value = timeCount;
    }

    /**
     * Samples new values for all the values in the 3D volume atlas.
     *
     * @param {Function} sampler      - The function that returns a value for (xi, yi, zi, x, y, z, t).
     *                                  Signature: (xi:number, yi:number, zi:number,
     *                                         x: number, y: number, z: number, t: number) => number.
     * @param {number}   [timeOffset] - The time offset where to begin updating.
     * @param {number}   [timeCount]  - The time count to update.
     *
     * @returns {object} An object containing:
     *   - minValue: The minimum value found in the updated values.
     *   - maxValue: The maximum value found in the updated values.
     */
    updateAtlasTexture(sampler, timeOffset = null, timeCount = null) {
        const {
            x: atlasResolutionX,
            y: atlasResolutionY,
            z: atlasResolutionZ,
        } = this.uniforms.atlasResolution.value;
        const {
            x: volumeResolutionX,
            y: volumeResolutionY,
            z: volumeResolutionZ,
        } = this.uniforms.volumeResolution.value;
        const {
            x: volumeOriginX,
            y: volumeOriginY,
            z: volumeOriginZ,
        } = this.uniforms.volumeOrigin.value;
        const {
            x: voxelSizeX,
            y: voxelSizeY,
            z: voxelSizeZ,
        } = this.uniforms.voxelSize.value;

        // Calculate atlas size in voxels
        const textureSizeX = volumeResolutionX * atlasResolutionX;
        const textureSizeY = volumeResolutionY * atlasResolutionY;
        const textureSizeZ = volumeResolutionZ * atlasResolutionZ;

       // Track min/max value
        let minValue = Number.POSITIVE_INFINITY;
        let maxValue = Number.NEGATIVE_INFINITY;

        // Force texture update
        this.uniforms.volumeAtlas.value.needsUpdate = true;

        const voxels = this.uniforms.volumeAtlas.data;

        // Iterate timesteps
        const start = timeOffset ?? 0;
        const count = timeCount ?? this.uniforms.timeCount.value;
        const end = start + Math.min(count, this.uniforms.timeCount.value);
        for (let t = start; t < end; t++) {
            // Calculate volume X/Y/Z index from timestep
            const volumeIndexX = t % atlasResolutionX;
            const volumeIndexY = Math.floor(t / atlasResolutionX) % atlasResolutionY;
            const volumeIndexZ = Math.floor(t / (atlasResolutionX * atlasResolutionY));

            // Iterate voxels
            for (let xi = 0; xi < volumeResolutionX; xi++) {
                for (let yi = 0; yi < volumeResolutionY; yi++) {
                    for (let zi = 0; zi < volumeResolutionZ; zi++) {
                        // Sample value
                        const value = sampler(xi, yi, zi,
                            xi * voxelSizeX + volumeOriginX,
                            yi * voxelSizeY + volumeOriginY,
                            zi * voxelSizeZ + volumeOriginZ, t);

                        minValue = Math.min(minValue, value);
                        maxValue = Math.max(maxValue, value);

                        // Calculate voxel index within the atlas
                        const xai = volumeIndexX * volumeResolutionX + xi;
                        const yai = volumeIndexY * volumeResolutionY + yi;
                        const zai = volumeIndexZ * volumeResolutionZ + zi;
                        const i = xai + yai * textureSizeX + zai * textureSizeX * textureSizeY;

                        voxels[i] = THREE.DataUtils.toHalfFloat(value);
                    }
                }
            }
        }

        return {
            minValue,
            maxValue,
        };
    }
}
