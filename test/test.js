const path = require("path");
const { describe, it, before, after } = require("mocha");
const axios = require("axios");
const { expect } = require("chai");
const packageJson = require("../package.json");

const { create } = require("../server");

const makeReq = (url, { method = "POST", path = "/v1/render", data = "", headers = {} } = {}) => {
  return axios({
    method: "POST",
    url: url + path,
    data: { mjml: data },
    validateStatus: false,
    headers
  });
};

describe("server", function () {
  let server;
  let url;

  before(async () => {
    server = create({ validationLevel: "strict" }).listen();
    url = `http://localhost:${server.address().port}`;
  });

  after(async () => {
    await server.close();
  });

  it("renders valid mjml", async () => {
    const data = `
    <mjml>
      <mj-body>
        <mj-section>
          <mj-column>
            <mj-text>
              Hello World!
            </mj-text>
          </mj-column>
        </mj-section>
      </mj-body>
    </mjml>`;
    const res = await makeReq(url, { data });
    expect(res.status).to.eql(200);
    expect(res.data.html).to.include("<!doctype html>");
    expect(res.data.mjml).to.eql(data);
    expect(res.data.mjml_version).to.eql(packageJson.dependencies.mjml);
    expect(res.data.errors).to.eql([]);
  });

  it("returns 500 on errors", async () => {
    const res = await makeReq(url, { data: "<mj-text foo=bar>hello</mj-text>" });
    expect(res.status).to.eql(500);
    expect(res.data).to.eql({
      message: "Failed to compile mjml",
      errors: [{
        line: 1,
        message: "Attribute foo is illegal",
        tagName: "mj-text",
        formattedMessage: `Line 1 of ${path.resolve(__dirname, "..")} (mj-text) — Attribute foo is illegal`
      }]
    });
  });

  it("returns 404 on invalid endpoint method", async () => {
    const res = await makeReq(url, { path: "/" });
    expect(res.status).to.eql(404);
  });

  // The old API did not pass a json object containing the key mjml. The entire
  // payload was a mjml document.
  it("is backwards compatible with the old API", async () => {
    const doc = `
    <mjml>
      <mj-body>
        <mj-section>
          <mj-column>
            <mj-text>
              Hello World!
            </mj-text>
          </mj-column>
        </mj-section>
      </mj-body>
    </mjml>`;
    const res = await axios({
      method: "POST",
      url: url + "/v1/render",
      headers: { "Content-Type": "" },
      data: doc,
      validateStatus: false
    });

    expect(res.status).to.eql(200);
    expect(res.data.html).to.include("<!doctype html>");
    expect(res.data.errors).to.eql([]);
  });
});

describe("with --max-body", function () {
  let server;
  let url;

  before(async () => {
    server = create({ maxBody: "10b" }).listen();
    url = `http://localhost:${server.address().port}`;
  });

  after(async () => {
    await server.close();
  });

  it("returns 413 for payloads larger than --max-body", async () => {
    const data = "o".repeat(10000);
    const payload = `
    <mjml>
      <mj-body>
        <mj-section>
          <mj-column>
            <mj-text>
              ${data}
            </mj-text>
          </mj-column>
        </mj-section>
      </mj-body>
    </mjml>`;
    const res = await makeReq(url, {
      data: payload
    });
    expect(res.status).to.eql(413);
  });
});

describe("with HTTP basic authentication", function () {
  let server;
  let url;
  let username;
  let password;
  const data = `
  <mjml>
    <mj-body>
      <mj-section>
        <mj-column>
          <mj-text>
            Hello World!
          </mj-text>
        </mj-column>
      </mj-section>
    </mj-body>
  </mjml>`;

  before(async () => {
    username = "test_user";
    password = "secreeeeet_pw";
    server = create({
      authentication: {
        enabled: true,
        type: "basic",
        basicAuth: {
          username,
          password
        }
      }
    }).listen();
    url = `http://${username}:${password}@localhost:${server.address().port}`;
  });

  after(async () => {
    await server.close();
  });

  it("authenticated user", async () => {
    const res = await makeReq(url, { data });
    expect(res.status).to.eql(200);
  });

  it("unauthenticated user", async () => {
    const fakeUsername = "mallory";
    const fakePassword = "admin123";
    const localUrl = `http://${fakeUsername}:${fakePassword}@localhost:${server.address().port}`;
    const res = await makeReq(localUrl, { data });

    expect(res.status).to.eql(401);
    expect(res.data.html).to.be.an("undefined");
  });

  it("missing credentials", async () => {
    const localUrl = `http://localhost:${server.address().port}`;
    const res = await makeReq(localUrl, { data });

    expect(res.status).to.eql(401);
    expect(res.data.html).to.be.an("undefined");
  });
});

describe("with token authentication", () => {
  let server;
  let url;
  let token;
  const data = `
  <mjml>
    <mj-body>
      <mj-section>
        <mj-column>
          <mj-text>
            Hello World!
          </mj-text>
        </mj-column>
      </mj-section>
    </mj-body>
  </mjml>`;

  before(async () => {
    token = Buffer.from("my_secret_token").toString("base64");
    server = create({
      authentication: {
        enabled: true,
        type: "token",
        token: {
          secret: token
        }
      }
    }).listen();
    url = `http://localhost:${server.address().port}`;
  });

  after(async () => {
    await server.close();
  });

  it("token as query parameter", async () => {
    const res = await makeReq(url, { path: `/v1/render?token=${token}`, data, headers: {} });
    expect(res.status).to.eql(200);
  });

  it("token as HTTP header", async () => {
    const res = await makeReq(url, { data, headers: { "X-Authentication-Token": token } });
    expect(res.status).to.eql(200);
  });

  it("wrong token as query parameter", async () => {
    const fakeToken = "121t13g134t1o2rnkrt1";
    const res = await makeReq(url, { path: `/v1/render?token=${fakeToken}`, data, headers: {} });
    expect(res.status).to.eql(401);
  });

  it("wrong token as HTTP Header", async () => {
    const fakeToken = "i21g13fb123porj12p3rh";
    const res = await makeReq(url, { data, headers: { "X-Authentication-Token": fakeToken } });
    expect(res.status).to.eql(401);
  });

  it("missing token", async () => {
    const res = await makeReq(url, { data });
    expect(res.status).to.eql(401);
  });
});
