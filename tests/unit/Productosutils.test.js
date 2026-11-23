import { describe, it, expect } from "vitest";
import {
  calcularPrecioVenta,
  precioMenorAlCosto,
  calcularMontoReposicion,
  formatearMoneda,
  escaparHTML,
  estadoStock,
  esRolAdmin,
  formatearFecha,
  parsearFecha,
  rolDesdeToken,
} from "../../frontend/js/utils/productosUtils.js";

describe("Utilidades de Productos", () => {
  // Pruebas de la Fórmula de Precio de Venta
  describe("calcularPrecioVenta", () => {
    it("calcula el precio con rentabilidad e IVA 21%", () => {
      // 1000 * 1.30 (30% rent) = 1300 * 1.21 (21% iva) = 1573
      expect(calcularPrecioVenta(1000, 30, 21)).toBe(1573);
    });

    it("calcula el precio sin rentabilidad (0%)", () => {
      // 1000 * 1.00 = 1000 * 1.21 = 1210
      expect(calcularPrecioVenta(1000, 0, 21)).toBe(1210);
    });

    it("calcula el precio con IVA 10.5%", () => {
      // 1000 * 1.00 = 1000 * 1.105 = 1105
      expect(calcularPrecioVenta(1000, 0, 10.5)).toBe(1105);
    });

    it("calcula el precio con IVA 0%", () => {
      expect(calcularPrecioVenta(1000, 50, 0)).toBe(1500);
    });

    it("devuelve 0 si el precio de compra es inválido", () => {
      expect(calcularPrecioVenta(0, 30, 21)).toBe(0);
      expect(calcularPrecioVenta(-100, 30, 21)).toBe(0);
    });
  });

  // Pruebas del Aviso de Precio
  describe("precioMenorAlCosto", () => {
    it("devuelve true si el precio de venta es menor al costo", () => {
      expect(precioMenorAlCosto(800, 1000)).toBe(true);
    });

    it("devuelve false si el precio de venta es mayor o igual al costo", () => {
      expect(precioMenorAlCosto(1000, 1000)).toBe(false);
      expect(precioMenorAlCosto(1200, 1000)).toBe(false);
    });
  });

  // Pruebas de Monto de Reposición
  describe("calcularMontoReposicion", () => {
    it("multiplica correctamente cantidad por costo", () => {
      expect(calcularMontoReposicion(5, 150.5)).toBe(752.5);
    });

    it("devuelve 0 si los datos son inválidos", () => {
      expect(calcularMontoReposicion(0, 150)).toBe(0);
      expect(calcularMontoReposicion(5, -10)).toBe(0);
    });
  });

  // Pruebas de Formato
  describe("formatearMoneda", () => {
    it("formatea a moneda argentina", () => {
      // Dependiendo de la configuración del sistema, el resultado puede variar un poco (espacios, etc.)
      // Pero validamos que contenga el símbolo $ y los decimales.
      const resultado = formatearMoneda(1500.5);
      expect(resultado).toContain("$");
      expect(resultado).toContain("1.500,50");
    });
  });
});

// --- Casos que faltaban: bordes de las funciones anteriores y las funciones que no tenían ningún test ---

// Arma un JWT sin firma (el front solo lee el payload) para probar rolDesdeToken.
const tokenCon = (payload) => `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.firma`;

describe("calcularPrecioVenta: bordes", () => {
  it("sin rentabilidad ni IVA usa 0% de rentabilidad y 21% de IVA", () => {
    expect(calcularPrecioVenta(100)).toBe(121);
  });

  it("redondea a dos decimales", () => {
    expect(calcularPrecioVenta(33.33, 10, 21)).toBe(44.36);
  });

  it("sin precio de compra devuelve 0", () => {
    expect(calcularPrecioVenta(undefined, 30, 21)).toBe(0);
    expect(calcularPrecioVenta(null, 30, 21)).toBe(0);
    expect(calcularPrecioVenta("", 30, 21)).toBe(0);
  });

  it("acepta el costo escrito como texto", () => {
    expect(calcularPrecioVenta("1000", 0, 0)).toBe(1000);
  });
});

describe("precioMenorAlCosto: bordes", () => {
  it("acepta números escritos como texto (vienen de los campos del formulario)", () => {
    expect(precioMenorAlCosto("500", "1000")).toBe(true);
    expect(precioMenorAlCosto("1000", "500")).toBe(false);
  });

  it("si falta alguno de los dos precios no avisa", () => {
    expect(precioMenorAlCosto("", "1000")).toBe(false);
    expect(precioMenorAlCosto("500", "")).toBe(false);
    expect(precioMenorAlCosto(undefined, undefined)).toBe(false);
  });

  it("una diferencia de un centavo ya cuenta", () => {
    expect(precioMenorAlCosto(99.99, 100)).toBe(true);
  });
});

describe("calcularMontoReposicion: bordes", () => {
  it("redondea a dos decimales", () => {
    expect(calcularMontoReposicion(3, 33.333)).toBe(100);
    expect(calcularMontoReposicion(3, 10.004)).toBe(30.01);
  });

  it("acepta los números escritos como texto", () => {
    expect(calcularMontoReposicion("5", "150")).toBe(750);
  });

  it("devuelve 0 si falta la cantidad o el costo", () => {
    expect(calcularMontoReposicion("", 100)).toBe(0);
    expect(calcularMontoReposicion(5, "")).toBe(0);
    expect(calcularMontoReposicion(undefined, undefined)).toBe(0);
    expect(calcularMontoReposicion(-3, 100)).toBe(0);
  });
});

describe("formatearMoneda: bordes", () => {
  it("muestra siempre dos decimales", () => {
    expect(formatearMoneda(1500)).toContain("1.500,00");
    expect(formatearMoneda(0)).toContain("0,00");
  });

  it("separa los miles con punto", () => {
    expect(formatearMoneda(1234567.89)).toContain("1.234.567,89");
  });

  it("un valor negativo lleva el signo menos", () => {
    expect(formatearMoneda(-250)).toContain("-");
    expect(formatearMoneda(-250)).toContain("250,00");
  });
});

describe("estadoStock", () => {
  it("sin unidades es SIN_STOCK", () => {
    expect(estadoStock(0, 5)).toBe("SIN_STOCK");
  });

  it("con un stock negativo también es SIN_STOCK", () => {
    expect(estadoStock(-2, 5)).toBe("SIN_STOCK");
  });

  it("por debajo del mínimo es BAJO", () => {
    expect(estadoStock(3, 5)).toBe("BAJO");
  });

  it("justo en el mínimo también es BAJO", () => {
    expect(estadoStock(5, 5)).toBe("BAJO");
  });

  it("por encima del mínimo es OK", () => {
    expect(estadoStock(6, 5)).toBe("OK");
  });

  it("con mínimo 0, una sola unidad ya es OK", () => {
    expect(estadoStock(1, 0)).toBe("OK");
  });
});

describe("escaparHTML", () => {
  it("escapa los cinco caracteres peligrosos", () => {
    expect(escaparHTML(`<a href="x" onclick='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; onclick=&#039;y&#039;&gt;&amp;&lt;/a&gt;");
  });

  it("neutraliza una etiqueta con código", () => {
    expect(escaparHTML("<img src=x onerror=alert(1)>")).not.toContain("<");
  });

  it("un texto común queda igual", () => {
    expect(escaparHTML("Sifón de soda 1 l")).toBe("Sifón de soda 1 l");
  });

  it("null y undefined dan texto vacío", () => {
    expect(escaparHTML(null)).toBe("");
    expect(escaparHTML(undefined)).toBe("");
  });

  it("convierte números a texto, incluido el 0", () => {
    expect(escaparHTML(0)).toBe("0");
    expect(escaparHTML(12.5)).toBe("12.5");
  });

  it("escapa el & una sola vez", () => {
    expect(escaparHTML("Tom & Jerry")).toBe("Tom &amp; Jerry");
  });
});

describe("rolDesdeToken", () => {
  it("lee el rol y lo devuelve en mayúsculas", () => {
    expect(rolDesdeToken(tokenCon({ rol: "admin" }))).toBe("ADMIN");
    expect(rolDesdeToken(tokenCon({ rol: "CAJERO" }))).toBe("CAJERO");
    expect(rolDesdeToken(tokenCon({ rol: "Propietario" }))).toBe("PROPIETARIO");
  });

  it("sin token devuelve null", () => {
    expect(rolDesdeToken(null)).toBeNull();
    expect(rolDesdeToken(undefined)).toBeNull();
    expect(rolDesdeToken("")).toBeNull();
  });

  it("un token sin las tres partes devuelve null", () => {
    expect(rolDesdeToken("abc")).toBeNull();
  });

  it("un token cuyo contenido no se puede leer devuelve null", () => {
    expect(rolDesdeToken("a.%%%.c")).toBeNull();
    expect(rolDesdeToken(`a.${Buffer.from("no es json").toString("base64url")}.c`)).toBeNull();
  });

  it("si el token no trae rol devuelve null", () => {
    expect(rolDesdeToken(tokenCon({ usuario: "ana" }))).toBeNull();
    expect(rolDesdeToken(tokenCon({ rol: "" }))).toBeNull();
  });

  it("entiende los tokens en base64 para URL (con - y _)", () => {
    const token = tokenCon({ rol: "cajero", relleno: "????" });
    expect(token.split(".")[1]).toMatch(/[_-]/);
    expect(rolDesdeToken(token)).toBe("CAJERO");
  });
});

describe("esRolAdmin", () => {
  it.each(["ADMIN", "admin", "Admin", "PROPIETARIO", "propietario"])("%s es administrador", (rol) => {
    expect(esRolAdmin(rol)).toBe(true);
  });

  it.each(["CAJERO", "cajero", "EMPLEADO", "ADMINISTRADOR", ""])("'%s' no es administrador", (rol) => {
    expect(esRolAdmin(rol)).toBe(false);
  });

  it("sin rol no es administrador", () => {
    expect(esRolAdmin(null)).toBe(false);
    expect(esRolAdmin(undefined)).toBe(false);
  });
});

describe("formatearFecha (aaaa-mm-dd -> dd-mm-aaaa)", () => {
  it("convierte una fecha del Backend", () => {
    expect(formatearFecha("2026-11-05")).toBe("05-11-2026");
  });

  it("ignora la hora si viene con ella", () => {
    expect(formatearFecha("2026-11-05T12:10:00Z")).toBe("05-11-2026");
  });

  it("sin fecha muestra un guion", () => {
    expect(formatearFecha("")).toBe("—");
    expect(formatearFecha(null)).toBe("—");
    expect(formatearFecha(undefined)).toBe("—");
  });

  it("un formato que no reconoce lo deja como está", () => {
    expect(formatearFecha("05/11/2026")).toBe("05/11/2026");
    expect(formatearFecha("2026-11")).toBe("2026-11");
  });
});

describe("parsearFecha", () => {
  it("devuelve una fecha local con el año, mes y día correctos", () => {
    const fecha = parsearFecha("2026-11-05");
    expect(fecha.getFullYear()).toBe(2026);
    expect(fecha.getMonth()).toBe(10);
    expect(fecha.getDate()).toBe(5);
  });

  it("no cambia de día por la zona horaria (es fecha local, no UTC)", () => {
    expect(parsearFecha("2026-01-01").getDate()).toBe(1);
    expect(parsearFecha("2026-12-31").getDate()).toBe(31);
  });

  it("ignora la hora si viene con ella", () => {
    expect(parsearFecha("2026-11-05T23:59:00Z").getDate()).toBe(5);
  });

  it("sin fecha o con un formato que no reconoce devuelve null", () => {
    expect(parsearFecha("")).toBeNull();
    expect(parsearFecha(null)).toBeNull();
    expect(parsearFecha("2026-11")).toBeNull();
    expect(parsearFecha("05/11/2026")).toBeNull();
  });
});
