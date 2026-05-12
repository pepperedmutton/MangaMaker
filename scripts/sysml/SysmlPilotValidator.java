import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.List;
import org.eclipse.xtext.validation.Issue;
import org.omg.sysml.interactive.SysMLInteractive;
import org.omg.sysml.interactive.SysMLInteractiveResult;

public class SysmlPilotValidator {
  private static String jsonEscape(String value) {
    if (value == null) {
      return "null";
    }
    StringBuilder out = new StringBuilder("\"");
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      switch (c) {
        case '\\':
          out.append("\\\\");
          break;
        case '"':
          out.append("\\\"");
          break;
        case '\n':
          out.append("\\n");
          break;
        case '\r':
          out.append("\\r");
          break;
        case '\t':
          out.append("\\t");
          break;
        default:
          if (c < 0x20) {
            out.append(String.format("\\u%04x", (int)c));
          } else {
            out.append(c);
          }
      }
    }
    out.append("\"");
    return out.toString();
  }

  private static void printIssue(StringBuilder sb, Issue issue) {
    sb.append("{");
    sb.append("\"severity\":").append(jsonEscape(String.valueOf(issue.getSeverity()))).append(",");
    sb.append("\"message\":").append(jsonEscape(issue.getMessage())).append(",");
    sb.append("\"line\":").append(issue.getLineNumber() == null ? "null" : issue.getLineNumber()).append(",");
    sb.append("\"column\":").append(issue.getColumn() == null ? "null" : issue.getColumn()).append(",");
    sb.append("\"syntax\":").append(issue.isSyntaxError());
    sb.append("}");
  }

  private static void printException(PrintStream out, long startedAt, String message, Exception exception) {
    StringBuilder sb = new StringBuilder();
    sb.append("{\"ok\":false,");
    sb.append("\"durationMs\":").append(System.currentTimeMillis() - startedAt).append(",");
    sb.append("\"issueCount\":0,\"issues\":[],");
    sb.append("\"exception\":").append(jsonEscape(message + ": " + exception.toString()));
    sb.append("}");
    out.println(sb.toString());
  }

  public static void main(String[] args) {
    long startedAt = System.currentTimeMillis();
    PrintStream originalOut = System.out;
    PrintStream mutedOut = new PrintStream(new ByteArrayOutputStream(), true, StandardCharsets.UTF_8);
    if (args.length < 2) {
      originalOut.println("{\"ok\":false,\"durationMs\":0,\"issueCount\":0,\"issues\":[],\"exception\":\"Usage: SysmlPilotValidator <libraryDir> <file...>\"}");
      return;
    }

    try {
      System.setOut(mutedOut);
      SysMLInteractive interactive = SysMLInteractive.getInstance();
      interactive.loadLibrary(args[0]);
      StringBuilder source = new StringBuilder();
      for (int i = 1; i < args.length; i++) {
        source.append(Files.readString(Path.of(args[i]))).append("\n");
      }
      SysMLInteractiveResult result = interactive.process(source.toString(), false);
      List<Issue> issues = result.getIssues() == null ? Collections.emptyList() : result.getIssues();

      StringBuilder sb = new StringBuilder();
      sb.append("{\"ok\":").append(!result.hasErrors()).append(",");
      sb.append("\"durationMs\":").append(System.currentTimeMillis() - startedAt).append(",");
      sb.append("\"issueCount\":").append(issues.size()).append(",\"issues\":[");
      for (int i = 0; i < issues.size(); i++) {
        if (i > 0) {
          sb.append(",");
        }
        printIssue(sb, issues.get(i));
      }
      sb.append("],\"exception\":");
      sb.append(result.getException() == null ? "null" : jsonEscape(result.formatException()));
      sb.append("}");
      System.setOut(originalOut);
      originalOut.println(sb.toString());
    } catch (Exception exception) {
      System.setOut(originalOut);
      printException(originalOut, startedAt, "SysML Pilot validation failed", exception);
    }
  }
}
