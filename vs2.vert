attribute vec3  position;
attribute vec4  color;
attribute vec2  texCoord;
varying   vec4  vColor;
varying   vec2  vTexCoord;

void main() {
  vColor = color;
  vTexCoord = vec2(texCoord.s, 1.0 - texCoord.t);
  gl_Position = vec4(position, 1.0);
}

