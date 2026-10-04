using System;
using System.IO;
using System.Threading;
using System.Collections.Generic;
using System.Web.Script.Serialization;
public static class FakeCodex {
  public static void Main(string[] args) {
    var json = new JavaScriptSerializer();
    Console.InputEncoding = System.Text.Encoding.UTF8;
    Console.OutputEncoding = new System.Text.UTF8Encoding(false);
    var pidFile = Environment.GetEnvironmentVariable("TEST_PID");
    if (!String.IsNullOrEmpty(pidFile)) File.WriteAllText(pidFile, System.Diagnostics.Process.GetCurrentProcess().Id.ToString());
    if (args.Length > 0 && args[0] == "queue") {
      File.AppendAllText(Environment.GetEnvironmentVariable("TEST_QUEUE"), json.Serialize(args) + "\n");
      if (Environment.GetEnvironmentVariable("TEST_QUEUE_HANG") == "1") Thread.Sleep(Timeout.Infinite);
      Environment.Exit(Environment.GetEnvironmentVariable("TEST_FAIL") == "1" ? 1 : 0);
      return;
    }
    if (Environment.GetEnvironmentVariable("TEST_SILENT") == "1") { Thread.Sleep(Timeout.Infinite); return; }
    string line, name = null;
    while ((line = Console.ReadLine()) != null) {
      var message = json.Deserialize<Dictionary<string, object>>(line);
      if (!message.ContainsKey("id")) continue;
      int id = Convert.ToInt32(message["id"]);
      if (id == 1) Console.WriteLine(json.Serialize(new { id = 1, result = new { userAgent = "test" } }));
      if (id == 2 || id == 4) {
        var param = (Dictionary<string, object>)message["params"];
        Console.WriteLine(json.Serialize(new { id = id, result = new { thread = new {
          id = param["threadId"], cwd = Environment.GetEnvironmentVariable("TEST_ROOT"), name = name, source = "exec", status = new { type = "notLoaded" }
        } } }));
      }
      if (id == 3) {
        name = (string)((Dictionary<string, object>)message["params"])["name"];
        Console.WriteLine(json.Serialize(new { id = 3, result = new {} }));
      }
    }
  }
}
