export const UPDATE_INTERVAL_MS = 50; // Update loop runs every 50ms (~20 FPS)
export const GRAVITY = 2;             // Vertical acceleration per frame
export const WALK_SPEED = 3;          // Horizontal pixels per frame
export const JUMP_VELOCITY = -20;     // Initial jump force (negative is up)
export const JUMP_REACH_X = (WALK_SPEED * 2) * Math.abs(JUMP_VELOCITY / GRAVITY); // Max horizontal travel during jump ascent
export const MAX_JUMP_HEIGHT = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY); // Max vertical travel during jump ascent

export const State = {
    FALLING: 'FALLING',
    WALKING: 'WALKING',
    IDLE: 'IDLE',
    JUMPING: 'JUMPING',
    DRAGGING: 'DRAGGING'
};

/**
 * Utility to check if a window is maximized
 */
export function isWindowMaximized(window) {
    return window && window.maximized_horizontally && window.maximized_vertically;
}
